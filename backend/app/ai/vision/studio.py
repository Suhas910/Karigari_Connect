"""
Image studio -- deterministic enhancement.

The hard rule, from `TEAM_BUILD_GUIDE.md`:

    Image enhancement may improve background, exposure, crop, and perspective.
    It may not invent texture, pattern, material, or colour.

That single sentence rules out the entire generative toolbox. No inpainting, no
background replacement, no upscaling network, no "restore" model. Every operation
here is a closed-form transform of pixels that were actually captured, which is why
this module has no weights to download, no GPU, no API key, and no way to produce a
photograph of a product that does not exist.

That is not a limitation to apologise for. A buyer who receives a saree that does not
match its photograph is the failure this whole product is trying to avoid, and a
marketplace-standard "enhance" button is exactly how that happens. The constraint is
the feature.

## What is recorded

Every applied transform is appended to `transformations`, in order. The app shows the
original next to the enhanced image and never silently replaces it, so an artisan can
always see what was done and reject it.

## No white balance

A grey-world white balance used to run on every photo. It assumes the frame should
average to grey, so when the product fills most of the frame it removes the product's
own colour. Measured 2026-09-14 inside the drawn outline of each segmentation scene: it
shifted a beige pot's LAB b channel by 16.6 (warm to grey), a terracotta vessel's by 10.4,
and tinted background stripes the mask had taken in orange. Every test passed; opening
the output showed it. Colour is what a buyer relies on, so the studio no longer touches it.

The segmentation mask still takes in a little background at the product's edge (0.9% of
the background on the striped scene), which is left as captured rather than lifted.

## Contract note -- needs a team decision

`AI_INTERFACE_CONTRACTS.md` gives the example transformation vocabulary as
`["background_neutralization", "white_balance", "crop"]`. This module no longer emits
`white_balance` (see above), and also emits
`exposure_normalization` and `resize`, because doing those and labelling them as one
of the sanctioned three would be a lie in the audit trail. Adding two names to that
list is a contract change: per the document's own change process it must be proposed
to the team and updated in the document, the frontend fixtures and here in one change.
Until that happens, the frontend must tolerate unknown transformation names rather
than switching exhaustively on them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from ..contracts import AIError, ErrorCode, QualityReport
from .quality import DEFAULT_THRESHOLDS, QualityThresholds, assess, load_image, subject_mask

# Long edge for the published image. Downscale only: upscaling would be inventing
# pixels, which is the one thing this module must never do.
TARGET_LONG_EDGE = 1600

# How far the background may be lifted toward neutral, at most. Deliberately partial:
# flattening a backdrop to pure white erases the contact shadow that tells a buyer the
# object is three-dimensional and sitting on a surface.
BACKGROUND_LIFT = 0.55

# Margin kept around the subject when cropping, as a fraction of its longer side.
CROP_MARGIN = 0.12


@dataclass
class EnhancementResult:
    image: np.ndarray
    quality: QualityReport
    transformations: list[str] = field(default_factory=list)
    human_review_required: bool = False
    # (x, y, width, height) of the crop in the original photo's pixels, or None if uncropped.
    crop_box: tuple[int, int, int, int] | None = None


def _normalise_exposure(
    image: np.ndarray, mask: np.ndarray | None = None, target_median: float = 55.0
) -> tuple[np.ndarray, bool]:
    """Lift or lower overall brightness by a single gain on lightness, judged on the product.

    The gain comes from the product's own lightness when it can be found, and this was a
    real bug too. Judged on the whole frame, a dark cloth behind a correctly lit piece
    reads as a dark photo: on 2026-09-14 a red Channapatna flute on dark fabric got the
    maximum gain of 3 and came out pale pink, a colour the product does not have.

    Deliberately a gain, not a percentile stretch, and this was a real bug rather than
    a preference. A stretch maps the darkest pixel to black and the brightest to white,
    so on a typical product photo -- a dark object on a light backdrop -- it pins the
    *product* at zero and the backdrop at 100. The visual result is a black silhouette
    on white: technically better exposed, and no longer a photograph of the thing being
    sold. A monotone gain moves everything together and cannot invert or crush the
    tonal relationships inside the subject.

    Applied in LAB on the L channel only. Stretching or scaling RGB channels
    independently shifts hue, and shifting the colour of a dyed textile is inventing a
    material property.
    """
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    lightness = lab[:, :, 0]

    region = lightness[mask > 0] if mask is not None and mask.any() else lightness
    median = float(np.median(region))
    if median < 1e-3:
        return image, False  # nothing recoverable to scale

    gain = target_median / median
    # Below this the correction is invisible and only clutters the audit trail.
    if abs(gain - 1.0) < 0.08:
        return image, False
    # Capped: a large gain amplifies sensor noise into something that reads as texture,
    # which is the one thing this module must not manufacture.
    gain = float(np.clip(gain, 0.4, 3.0))

    lab[:, :, 0] = np.clip(lightness * gain, 0.0, 100.0).astype(lab.dtype)
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR).astype(np.float32), True


def _neutralise_background(image: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, bool]:
    """Lift and desaturate the background only. Subject pixels are never written.

    The mask is feathered and then inverted, so the blend falls to zero across the
    subject boundary and the object keeps its own edge. `test_studio.py` asserts the
    subject region is byte-identical after this step -- if that assertion ever fails,
    the module has started editing the product itself.
    """
    if not mask.any() or mask.all():
        return image, False

    feathered = cv2.GaussianBlur(mask.astype(np.float32) / 255.0, (0, 0), 6.0)
    # Anything with any subject weight at all is protected, not merely down-weighted.
    background_weight = np.where(mask > 0, 0.0, 1.0 - feathered)[:, :, None]

    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    hsv[:, :, 1] *= 0.35  # desaturate the backdrop, do not recolour it
    desaturated = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
    lifted = desaturated + (1.0 - desaturated) * BACKGROUND_LIFT

    blended = image * (1.0 - background_weight) + lifted * background_weight
    return np.clip(blended, 0.0, 1.0).astype(np.float32), True


def _crop_to_subject(
    image: np.ndarray, mask: np.ndarray
) -> tuple[np.ndarray, tuple[int, int, int, int] | None]:
    """Crop around the subject with a margin. Never crops into it. Returns the box, or None."""
    if not mask.any():
        return image, None

    xs = np.flatnonzero(mask.any(axis=0))
    ys = np.flatnonzero(mask.any(axis=1))
    x0, x1 = int(xs[0]), int(xs[-1])
    y0, y1 = int(ys[0]), int(ys[-1])

    height, width = image.shape[:2]
    margin = int(round(max(x1 - x0, y1 - y0) * CROP_MARGIN))
    nx0, ny0 = max(0, x0 - margin), max(0, y0 - margin)
    nx1, ny1 = min(width - 1, x1 + margin), min(height - 1, y1 + margin)

    # Not worth recording a crop that removes almost nothing.
    if (nx1 - nx0 + 1) * (ny1 - ny0 + 1) > 0.95 * width * height:
        return image, None
    return image[ny0:ny1 + 1, nx0:nx1 + 1], (nx0, ny0, nx1 - nx0 + 1, ny1 - ny0 + 1)


def _resize(image: np.ndarray, target_long_edge: int) -> tuple[np.ndarray, bool]:
    height, width = image.shape[:2]
    long_edge = max(height, width)
    if long_edge <= target_long_edge:
        return image, False  # downscale only; upscaling would invent pixels
    scale = target_long_edge / long_edge
    resized = cv2.resize(
        image, (max(1, round(width * scale)), max(1, round(height * scale))), interpolation=cv2.INTER_AREA
    )
    return resized, True


def enhance(
    source: Path | str | np.ndarray,
    *,
    quality: QualityReport | None = None,
    thresholds: QualityThresholds = DEFAULT_THRESHOLDS,
    target_long_edge: int = TARGET_LONG_EDGE,
) -> EnhancementResult:
    """Produce a publishing-grade image, or refuse.

    Refusal is a feature. `AI_INTERFACE_CONTRACTS.md`: "If quality is insufficient, no
    enhancement should be treated as a publishing-grade photo. Return retake guidance
    instead." An unacceptable photo therefore raises `MEDIA_QUALITY_INSUFFICIENT`
    carrying that guidance, rather than returning a cleaned-up version of nothing.
    """
    original = load_image(source)
    report = quality if quality is not None else assess(original, thresholds)

    if not report.is_usable:
        raise AIError(
            ErrorCode.MEDIA_QUALITY_INSUFFICIENT,
            "This photo cannot be used for a listing. " + " ".join(report.guidance),
            recoverable=True,
            action="retake_photo",
        )

    working = original.astype(np.float32) / 255.0
    applied: list[str] = []

    # Order matters. Exposure runs on the full frame before the subject is located,
    # because the mask is easier to find on a corrected image. Only correct exposure the
    # assessor actually judged wrong. An unconditional correction on an acceptable photo
    # is a change made for no reason, and every change here is a change to how a real
    # product looks to a buyer.
    if report.lighting != "acceptable":
        working, changed = _normalise_exposure(working, subject_mask(original))
        if changed:
            applied.append("exposure_normalization")

    mask = subject_mask((working * 255).astype(np.uint8))

    working, changed = _neutralise_background(working, mask)
    if changed:
        applied.append("background_neutralization")

    working, crop_box = _crop_to_subject(working, mask)
    if crop_box is not None:
        applied.append("crop")

    working, changed = _resize(working, target_long_edge)
    if changed:
        applied.append("resize")

    enhanced = np.clip(working * 255.0, 0, 255).astype(np.uint8)

    return EnhancementResult(
        image=enhanced,
        quality=report,
        transformations=applied,
        # A photo that only just cleared the bar goes to a coordinator before it
        # reaches a buyer. The studio improves it; it cannot certify it.
        human_review_required=report.overall == "needs_correction",
        crop_box=crop_box,
    )
