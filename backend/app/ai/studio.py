# backend/app/ai/studio.py
"""
Catalogue studio for listing photos: straighten the product, relight it like a studio shot and
place it on a catalogue background.

Two engines produce the same kind of result:

- "processing" (default): BiRefNet cuts the product out, then deterministic image processing
  levels the angle, corrects exposure and colour cast, and composites the product onto the
  background. Pixels of the product are only adjusted, never redrawn.
- "ai": a Gemini image model edits the photo from a prompt. Generative edits can redraw a product
  (colour, pattern, shape), so every AI result is checked against the original photo and falls
  back to "processing" when it drifts, when the model is unavailable, or when it returns no image.
  AI results always require human review.
"""
import io
import os
import logging
from dataclasses import dataclass, field
from typing import Callable, Dict, Any, List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image, ImageOps

from . import birefnet

logger = logging.getLogger(__name__)

ENGINES = ("processing", "ai")
BACKGROUNDS = ("studio", "white")

GEMINI_IMAGE_MODEL = os.getenv("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image")

MAX_WORKING_SIDE = 2048          # larger photos are downscaled before processing
MIN_FOREGROUND_FRACTION = 0.01   # below this, BiRefNet found no product
MAX_LEVEL_ANGLE = 30.0           # tilts beyond this are treated as intentional
MIN_TILT_ANGLE = 0.75            # tilts below this are left alone
TILT_AREA_RATIO = 0.92           # rotated box must be this much tighter than the upright box
PRODUCT_FILL = 0.78              # product's longest side as a share of the canvas
CANVAS_MIN, CANVAS_MAX = 1024, 2048
MAX_WHITE_BALANCE_GAIN = 0.06    # colour-cast correction is capped at +/-6% per channel
MAX_NEUTRAL_A, MAX_NEUTRAL_CHROMA = 8.0, 30.0  # background colour beyond this is surface, not cast
TARGET_MEDIAN_LINEAR = 0.18      # photographic mid-grey for the product's median luminance
MIN_EXPOSURE_GAIN, MAX_EXPOSURE_GAIN = 0.7, 2.0  # about -0.5 EV to +1 EV
MAX_AI_CHROMA_DRIFT = 12.0       # mean a*b* distance allowed between original and AI product
MAX_AI_SHAPE_DRIFT = 0.15        # relative aspect-ratio change allowed for the AI product
MIN_AI_AREA_FRACTION = 0.05      # AI output must still show a product of reasonable size

MaskFn = Callable[[Image.Image], Image.Image]


@dataclass
class StudioResult:
    image_bytes: bytes
    engine: str
    transformations: List[str]
    details: Dict[str, Any] = field(default_factory=dict)
    human_review_required: bool = False


class NoProductDetected(ValueError):
    """BiRefNet found no foreground product in the photo."""


# --- shared helpers -------------------------------------------------------------------------

def _load(image_bytes: bytes) -> Image.Image:
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    if max(image.size) > MAX_WORKING_SIDE:
        image.thumbnail((MAX_WORKING_SIDE, MAX_WORKING_SIDE), Image.LANCZOS)
    return image


def _to_jpeg(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=92)
    return out.getvalue()


def _largest_contour(binary: np.ndarray) -> Optional[np.ndarray]:
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return max(contours, key=cv2.contourArea) if contours else None


def _binary(mask: np.ndarray) -> np.ndarray:
    return (mask >= 128).astype(np.uint8) * 255


# --- angle ----------------------------------------------------------------------------------

def estimate_tilt(mask: np.ndarray) -> float:
    """
    Degrees to rotate the photo (counter-clockwise positive, PIL convention) so the product sits
    level. Returns 0 for shapes without a dominant orientation, such as round pots.
    """
    contour = _largest_contour(_binary(mask))
    if contour is None or cv2.contourArea(contour) == 0:
        return 0.0

    (_, _), (w, h), angle = cv2.minAreaRect(contour)
    _, _, bw, bh = cv2.boundingRect(contour)
    if w * h >= TILT_AREA_RATIO * bw * bh:
        return 0.0  # already level, or no orientation to recover

    # OpenCV versions disagree on the box-angle range ((0, 90] vs [-90, 0)); fold it into [-45, 45),
    # the smallest rotation that levels the box.
    angle = (angle + 45) % 90 - 45
    if abs(angle) < MIN_TILT_ANGLE or abs(angle) > MAX_LEVEL_ANGLE:
        return 0.0
    return float(angle)


def _rotate(image: Image.Image, mask: Image.Image, degrees: float):
    rotated = image.rotate(degrees, resample=Image.BICUBIC, expand=True, fillcolor=(255, 255, 255))
    rotated_mask = mask.rotate(degrees, resample=Image.BILINEAR, expand=True, fillcolor=0)
    return rotated, rotated_mask


# --- lighting -------------------------------------------------------------------------------

def _white_balance(rgb: np.ndarray, weights: np.ndarray) -> Tuple[np.ndarray, List[float]]:
    """
    Remove a colour cast using the background, not the product: a red pot must stay red.
    Only a near-neutral background (floor, wall, paper, cloth in greys or creams) is a usable
    reference; a green cloth would be "corrected" into magenta, so coloured backgrounds are skipped.
    Gains are capped to a few percent either way.
    """
    background = weights < 0.1
    if background.sum() < 0.05 * weights.size:
        return rgb, [1.0, 1.0, 1.0]  # product fills the frame; nothing neutral to measure

    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float64)
    a = float(np.median(lab[..., 1][background])) - 128
    b = float(np.median(lab[..., 2][background])) - 128
    # Illuminant casts run warm-cool (b*); strong green-magenta (a*) or high chroma is surface colour.
    if abs(a) > MAX_NEUTRAL_A or np.hypot(a, b) > MAX_NEUTRAL_CHROMA:
        return rgb, [1.0, 1.0, 1.0]

    pixels = rgb[background].astype(np.float64) / 255.0
    illuminant = np.power(np.mean(np.power(pixels + 1e-6, 6), axis=0), 1 / 6)
    gains = illuminant.mean() / np.maximum(illuminant, 1e-6)
    gains = np.clip(gains, 1 - MAX_WHITE_BALANCE_GAIN, 1 + MAX_WHITE_BALANCE_GAIN)
    balanced = np.clip(rgb.astype(np.float64) * gains, 0, 255).astype(np.uint8)
    return balanced, [round(float(g), 3) for g in gains]


def _studio_light(rgb: np.ndarray, weights: np.ndarray) -> Dict[str, Any]:
    """
    Studio exposure on the product. Exposure is a gain in linear light, like opening the aperture,
    so colours keep their saturation (lifting Lab lightness alone turns terracotta pink). The gain is
    capped: the photo cannot tell a dim room from a dark material, and a dark pot must stay dark.
    A highlight shoulder avoids blown whites; gentle local contrast and a soft key light follow.
    """
    srgb = rgb.astype(np.float64) / 255.0
    linear = np.power(srgb, 2.2)
    luminance = linear @ np.array([0.2126, 0.7152, 0.0722])
    product = weights > 0.5
    values = luminance[product] if product.sum() > 100 else luminance.ravel()
    median = float(np.median(values))

    gain = float(np.clip(TARGET_MEDIAN_LINEAR / max(median, 1e-4), MIN_EXPOSURE_GAIN, MAX_EXPOSURE_GAIN))
    exposed = linear * gain
    # Soft shoulder: values above the knee compress smoothly towards 1 instead of clipping.
    knee = 0.8
    over = np.maximum(exposed - knee, 0)
    exposed = np.where(exposed > knee, knee + (1 - knee) * (1 - np.exp(-over / (1 - knee))), exposed)
    out = np.power(np.clip(exposed, 0, 1), 1 / 2.2)

    lab = cv2.cvtColor((out * 255).astype(np.uint8), cv2.COLOR_RGB2LAB)
    lightness = lab[..., 0].astype(np.float64)
    # Local contrast brings out weave, grain and carving detail.
    clahe = cv2.createCLAHE(clipLimit=1.4, tileGridSize=(8, 8)).apply(lab[..., 0])
    lightness = 0.8 * lightness + 0.2 * clahe.astype(np.float64)
    # Soft key light from the upper left, +/-3%.
    h, w = lightness.shape
    yy, xx = np.mgrid[0:h, 0:w]
    lightness *= 1.03 - 0.06 * (xx / max(w - 1, 1) + yy / max(h - 1, 1)) / 2
    lab[..., 0] = np.clip(lightness, 0, 255).astype(np.uint8)

    return {
        "image": cv2.cvtColor(lab, cv2.COLOR_LAB2RGB),
        "exposure_ev": round(float(np.log2(gain)), 2),
        "median_luminance_before": round(median, 4),
    }


# --- background -----------------------------------------------------------------------------

def _catalogue_background(size: int, style: str) -> np.ndarray:
    if style == "white":
        return np.full((size, size, 3), 255, dtype=np.float64)
    # Seamless studio sweep: bright centre, gentle fall-off towards the floor and corners.
    yy, xx = np.mgrid[0:size, 0:size] / max(size - 1, 1)
    vertical = 252 - 14 * np.clip((yy - 0.55) / 0.45, 0, 1) ** 1.5
    radial = 5 * np.clip(np.hypot(xx - 0.5, yy - 0.42) / 0.75, 0, 1) ** 2
    tone = vertical - radial
    return np.stack([tone, tone, tone + 1.5], axis=-1)


def _contact_shadow(alpha: np.ndarray, top: int, left: int, size: int) -> np.ndarray:
    """Soft shadow under the product's base, as a darkening factor over the canvas."""
    h, w = alpha.shape
    shadow = np.zeros((size, size), dtype=np.float64)
    base_height = max(4, int(h * 0.08))
    footprint = cv2.resize(alpha, (w, base_height), interpolation=cv2.INTER_AREA)
    y0 = min(size - base_height, top + h - base_height // 2)
    shadow[y0:y0 + base_height, left:left + w] = footprint
    blur = max(3, int(size * 0.025)) | 1
    shadow = cv2.GaussianBlur(shadow, (blur * 3 | 1, blur | 1), 0)
    return 1 - 0.28 * np.clip(shadow / max(shadow.max(), 1e-6), 0, 1)


def _compose(image: np.ndarray, alpha: np.ndarray, style: str) -> Image.Image:
    """Crop to the product, centre it on a square catalogue canvas with consistent margins."""
    ys, xs = np.nonzero(alpha > 0.5)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    product, product_alpha = image[y0:y1, x0:x1], alpha[y0:y1, x0:x1]

    longest = max(y1 - y0, x1 - x0)
    # Never upscale the product by more than 1.5x; a smaller canvas beats a blurry product.
    size = int(np.clip(longest / PRODUCT_FILL, CANVAS_MIN, CANVAS_MAX))
    size = int(min(size, max(CANVAS_MIN, longest * 1.5 / PRODUCT_FILL)))
    scale = PRODUCT_FILL * size / longest
    new_w, new_h = max(1, round((x1 - x0) * scale)), max(1, round((y1 - y0) * scale))
    interpolation = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
    product = cv2.resize(product.astype(np.float64), (new_w, new_h), interpolation=interpolation)
    product_alpha = np.clip(cv2.resize(product_alpha, (new_w, new_h), interpolation=cv2.INTER_LINEAR), 0, 1)

    canvas = _catalogue_background(size, style)
    top, left = (size - new_h) // 2, (size - new_w) // 2
    if style == "studio":
        canvas *= _contact_shadow(product_alpha, top, left, size)[..., None]

    region = canvas[top:top + new_h, left:left + new_w]
    a = product_alpha[..., None]
    canvas[top:top + new_h, left:left + new_w] = product * a + region * (1 - a)
    return Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8))


def _refine_alpha(mask: Image.Image) -> np.ndarray:
    """Pull the matte edge in by a pixel and soften it, which removes halos of the old background."""
    alpha = np.asarray(mask, dtype=np.float64) / 255.0
    alpha = cv2.erode(alpha, np.ones((3, 3), np.uint8), iterations=1)
    return np.clip(cv2.GaussianBlur(alpha, (3, 3), 0.8), 0, 1)


# --- engines --------------------------------------------------------------------------------

def process_photo(image_bytes: bytes, background: str = "studio", mask_fn: Optional[MaskFn] = None) -> StudioResult:
    """Deterministic engine: BiRefNet cut-out, levelled, relit and composited on a catalogue background."""
    mask_fn = mask_fn or birefnet.predict_mask
    image = _load(image_bytes)
    mask = mask_fn(image)
    mask_np = np.asarray(mask)
    if (mask_np >= 128).mean() < MIN_FOREGROUND_FRACTION:
        raise NoProductDetected("No product was found in the photo. Retake it with the product filling more of the frame.")

    transformations = ["background_neutralization"]
    tilt = estimate_tilt(mask_np)
    if tilt:
        image, mask = _rotate(image, mask, tilt)
        transformations.append("angle_correction")

    alpha = _refine_alpha(mask)
    rgb, gains = _white_balance(np.asarray(image), alpha)
    if gains != [1.0, 1.0, 1.0]:
        transformations.append("white_balance")
    light = _studio_light(rgb, alpha)
    transformations.append("studio_lighting")

    result = _compose(light["image"], alpha, background)
    transformations.extend(["crop", "catalogue_background"])
    return StudioResult(
        image_bytes=_to_jpeg(result),
        engine="processing",
        transformations=transformations,
        details={
            "segmentation_model": birefnet.MODEL_ID,
            "background": background,
            "tilt_corrected_degrees": round(tilt, 2),
            "white_balance_gains": gains,
            "exposure_ev": light["exposure_ev"],
            "median_luminance_before": light["median_luminance_before"],
        },
    )


def _ai_prompt(background: str) -> str:
    backdrop = (
        "a pure white (#FFFFFF) seamless background with no shadow gradient"
        if background == "white" else
        "a clean, seamless off-white studio sweep with a soft, natural contact shadow under the product"
    )
    return (
        "Edit this photo of a handmade craft product into a professional e-commerce catalogue photo.\n"
        "1. Correct the camera angle: level the product so it sits straight, as if shot square-on.\n"
        f"2. Replace the background with {backdrop}.\n"
        "3. Relight it like a studio shot: soft, even key light, no harsh shadows or blown highlights.\n"
        "Strict rules, this photo is used as evidence of what the artisan made:\n"
        "- Keep the product exactly as it is: same shape, proportions, colours, dyes, patterns, "
        "texture, weave, grain, surface marks, imperfections and any text or signatures.\n"
        "- Do not add, remove, repair, restyle or beautify any part of the product.\n"
        "- No props, hands, text, logos or decorations. Show the whole product, centred.\n"
        "Return only the edited image."
    )


def _generate_ai_edit(image: Image.Image, background: str) -> bytes:
    from .gemini_client import gemini_client
    from google.genai import types

    if not gemini_client.client:
        raise RuntimeError("GEMINI_API_KEY is not configured")

    source = io.BytesIO()
    image.save(source, format="JPEG", quality=95)
    response = gemini_client.client.models.generate_content(
        model=GEMINI_IMAGE_MODEL,
        contents=[types.Part.from_bytes(data=source.getvalue(), mime_type="image/jpeg"), _ai_prompt(background)],
        config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
    )
    for candidate in response.candidates or []:
        for part in (candidate.content.parts if candidate.content else None) or []:
            if part.inline_data and part.inline_data.data:
                return part.inline_data.data
    raise RuntimeError("Gemini returned no image")


def _product_signature(image: Image.Image, mask: np.ndarray) -> Dict[str, float]:
    binary = _binary(mask)
    contour = _largest_contour(binary)
    lab = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2LAB).astype(np.float64)
    product = binary > 0
    (_, _), (w, h), _ = cv2.minAreaRect(contour) if contour is not None else ((0, 0), (1, 1), 0)
    return {
        "area_fraction": float(product.mean()),
        "a": float(lab[..., 1][product].mean()) if product.any() else 128.0,
        "b": float(lab[..., 2][product].mean()) if product.any() else 128.0,
        "aspect": float(max(w, h) / max(min(w, h), 1)),
    }


def check_ai_fidelity(original: Image.Image, original_mask: np.ndarray,
                      edited: Image.Image, edited_mask: np.ndarray) -> Dict[str, Any]:
    """
    Compare the product in the AI edit with the product in the original photo. Lighting is expected
    to change, so colour is compared on chroma (Lab a*, b*) only; shape on the product's aspect ratio,
    which is unaffected by straightening.
    """
    before, after = _product_signature(original, original_mask), _product_signature(edited, edited_mask)
    chroma_drift = float(np.hypot(before["a"] - after["a"], before["b"] - after["b"]))
    shape_drift = float(abs(after["aspect"] - before["aspect"]) / before["aspect"])
    reasons = []
    if after["area_fraction"] < MIN_AI_AREA_FRACTION:
        reasons.append("product missing or too small in the AI image")
    if chroma_drift > MAX_AI_CHROMA_DRIFT:
        reasons.append(f"product colour changed (drift {chroma_drift:.1f} > {MAX_AI_CHROMA_DRIFT})")
    if shape_drift > MAX_AI_SHAPE_DRIFT:
        reasons.append(f"product shape changed (drift {shape_drift:.2f} > {MAX_AI_SHAPE_DRIFT})")
    return {
        "passed": not reasons,
        "reasons": reasons,
        "chroma_drift": round(chroma_drift, 2),
        "shape_drift": round(shape_drift, 3),
    }


def ai_photo(image_bytes: bytes, background: str = "studio", mask_fn: Optional[MaskFn] = None) -> StudioResult:
    """
    AI engine: Gemini edits the photo, then the edit is verified against the original. Any failure
    falls back to the processing engine and the reason is recorded in details["ai_fallback_reason"].
    """
    mask_fn = mask_fn or birefnet.predict_mask
    original = _load(image_bytes)

    try:
        edited = _load(_generate_ai_edit(original, background))
        original_mask = np.asarray(mask_fn(original))
        edited_mask = np.asarray(mask_fn(edited))
        fidelity = check_ai_fidelity(original, original_mask, edited, edited_mask)
    except Exception as exc:
        logger.warning("AI studio edit unavailable, using processing: %s", _short_error(exc))
        return _fallback(image_bytes, background, mask_fn, f"AI edit failed: {_short_error(exc)}", None)

    if not fidelity["passed"]:
        logger.warning("AI studio edit rejected by fidelity check: %s", fidelity["reasons"])
        return _fallback(image_bytes, background, mask_fn,
                         "AI edit changed the product: " + "; ".join(fidelity["reasons"]), fidelity)

    return StudioResult(
        image_bytes=_to_jpeg(edited),
        engine="ai",
        transformations=["angle_correction", "catalogue_background", "studio_lighting", "generative_edit"],
        details={"image_model": GEMINI_IMAGE_MODEL, "background": background, "fidelity": fidelity},
        # A generated image must be checked by a person before it represents the artisan's work.
        human_review_required=True,
    )


def _short_error(exc: Exception) -> str:
    text = str(exc)
    if "RESOURCE_EXHAUSTED" in text or "429" in text:
        return "Gemini image quota exhausted (image models need billing enabled on the API project)"
    return text.splitlines()[0][:200] if text else type(exc).__name__


def _fallback(image_bytes: bytes, background: str, mask_fn: MaskFn, reason: str,
              fidelity: Optional[Dict[str, Any]]) -> StudioResult:
    result = process_photo(image_bytes, background=background, mask_fn=mask_fn)
    result.details["requested_engine"] = "ai"
    result.details["ai_fallback_reason"] = reason
    if fidelity:
        result.details["ai_fidelity"] = fidelity
    return result


def enhance(image_bytes: bytes, engine: str = "processing", background: str = "studio",
            mask_fn: Optional[MaskFn] = None) -> StudioResult:
    if engine not in ENGINES:
        raise ValueError(f"engine must be one of {ENGINES}")
    if background not in BACKGROUNDS:
        raise ValueError(f"background must be one of {BACKGROUNDS}")
    if engine == "ai":
        return ai_photo(image_bytes, background=background, mask_fn=mask_fn)
    return process_photo(image_bytes, background=background, mask_fn=mask_fn)
