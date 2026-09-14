"""
Image studio.

The load-bearing test here is `test_background_neutralisation_never_touches_the_subject`.
The product's promise is that enhancement improves presentation without altering the
product, and that test is the mechanical form of that promise.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from app.ai.contracts import AIError, ErrorCode
from app.ai.fixtures.segmentation_scenes import SCENE_NAMES, scenes
from app.ai.vision.quality import assess, subject_mask
from app.ai.vision.studio import _neutralise_background, enhance

from .conftest import image_fixture


def test_good_photo_is_enhanced_and_every_transform_recorded():
    result = enhance(image_fixture("good"))
    assert result.transformations, "an enhancement that did nothing should say so, not silently pass"
    assert len(set(result.transformations)) == len(result.transformations)
    assert result.image.dtype == np.uint8


@pytest.mark.parametrize("stem", ["blurred", "overexposed", "subject_too_small", "low_resolution"])
def test_unusable_photos_are_refused_with_retake_guidance(stem):
    """`AI_INTERFACE_CONTRACTS.md`: return retake guidance, not a cleaned-up nothing."""
    with pytest.raises(AIError) as excinfo:
        enhance(image_fixture(stem))
    assert excinfo.value.code is ErrorCode.MEDIA_QUALITY_INSUFFICIENT
    assert excinfo.value.recoverable is True
    assert excinfo.value.action == "retake_photo"
    assert len(excinfo.value.message) > len("This photo cannot be used for a listing.")


@pytest.mark.parametrize("scene", SCENE_NAMES)
def test_background_neutralisation_never_touches_the_subject(scene):
    """The promise, mechanically.

    Enhancement may improve the background. It may not alter the product, because a
    buyer receiving something that does not match its photograph is the exact failure
    this product exists to prevent.

    The mask is the drawn outline of the product, not a computed one. The earlier
    version of this test took the mask from `subject_mask`, so a wrong mask still passed.
    """
    bgr, mask = scenes()[scene]
    image = bgr.astype(np.float32) / 255.0
    neutralised, changed = _neutralise_background(image, mask)

    assert changed
    subject = mask > 0
    assert subject.any()
    np.testing.assert_array_equal(image[subject], neutralised[subject])
    # ...and it must actually have done something outside the subject.
    assert not np.array_equal(image[~subject], neutralised[~subject])


def test_enhancement_does_not_invent_detail():
    """No transform may raise fine detail that was not captured.

    `TEAM_BUILD_GUIDE.md` forbids inventing texture. Deterministic transforms cannot,
    but a future "improvement" reaching for an upscaler or a sharpening filter would,
    and this is the test that would stop it.
    """
    original = cv2.imread(str(image_fixture("good")))
    result = enhance(image_fixture("good"))

    def detail(image: np.ndarray) -> float:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
        gray = cv2.resize(gray, (512, 512), interpolation=cv2.INTER_AREA)
        low, high = np.percentile(gray, (2.0, 98.0))
        if high - low < 1e-4:
            return 0.0
        # np.percentile returns float64 scalars, which promote the array; OpenCV then
        # rejects a float64 source for a CV_32F destination. Cast back explicitly.
        normalised = np.clip((gray - low) / (high - low), 0.0, 1.0).astype(np.float32)
        return float(cv2.Laplacian(normalised, cv2.CV_32F, ksize=3).var())

    # A small tolerance: cropping removes smooth background, which legitimately raises
    # the average detail density without any detail having been created.
    assert detail(result.image) <= detail(original) * 2.0


def test_upscaling_never_happens():
    """Downscale only. Enlarging is inventing pixels."""
    original = cv2.imread(str(image_fixture("good")))
    result = enhance(image_fixture("good"))
    assert max(result.image.shape[:2]) <= max(original.shape[:2])


def test_marginal_photo_is_flagged_for_human_review():
    result = enhance(image_fixture("off_centre"))
    assert result.quality.overall == "needs_correction"
    assert result.human_review_required is True


def test_clean_photo_needs_no_human_review():
    assert enhance(image_fixture("good")).human_review_required is False


def test_transform_names_are_stable_strings():
    """The frontend renders these. Renaming one is a contract change."""
    known = {
        "exposure_normalization",
        "white_balance",
        "background_neutralization",
        "crop",
        "resize",
    }
    for stem in ("good", "off_centre", "underexposed"):
        assert set(enhance(image_fixture(stem)).transformations) <= known


def test_no_transform_is_recorded_that_did_not_happen():
    """A truthful audit trail includes truthfully omitting things.

    An evenly-dimmed photo has no colour cast, so grey-world must find nothing to do
    and must not log a correction it did not make.
    """
    result = enhance(image_fixture("underexposed"))
    assert "white_balance" not in result.transformations
    assert "exposure_normalization" in result.transformations


def test_quality_report_can_be_passed_in_to_avoid_recomputing():
    report = assess(image_fixture("good"))
    result = enhance(image_fixture("good"), quality=report)
    assert result.quality.model_dump() == report.model_dump()


@pytest.mark.parametrize("scene", SCENE_NAMES)
def test_studio_never_changes_the_products_own_pixels(scene):
    """Regression guard, found by opening the output on 2026-09-14.

    A grey-world white balance turned a beige pot grey (LAB b shifted by 16.6) and tinted
    background the mask had taken in orange, while every other test in this file passed.
    On a photo with acceptable lighting the studio may only lift the background and crop,
    so the inside of the product, taken from its drawn outline, must come out unchanged.
    """
    image, truth = scenes()[scene]
    result = enhance(image)
    assert result.quality.lighting == "acceptable", "the scene must not need exposure correction for this check"
    assert "resize" not in result.transformations

    x, y, w, h = result.crop_box or (0, 0, image.shape[1], image.shape[0])
    # Well inside the product, so the few edge pixels segmentation misses do not count.
    inner = cv2.erode(truth, np.ones((15, 15), np.uint8))[y:y + h, x:x + w] > 0
    assert inner.any()
    difference = np.abs(image[y:y + h, x:x + w].astype(int) - result.image.astype(int))[inner]
    assert difference.max() <= 1, f"product pixels changed by up to {difference.max()}"


def test_white_balance_is_never_applied():
    for stem in ("good", "off_centre", "underexposed"):
        assert "white_balance" not in enhance(image_fixture(stem)).transformations


def _subject_stats(image: np.ndarray, mask: np.ndarray) -> tuple[float, float]:
    """Median lightness and mean hue of the subject region, in LAB/HSV."""
    lab = cv2.cvtColor(image.astype(np.float32) / 255.0, cv2.COLOR_BGR2LAB)
    hsv = cv2.cvtColor(image.astype(np.float32) / 255.0, cv2.COLOR_BGR2HSV)
    subject = mask > 0
    return float(np.median(lab[:, :, 0][subject])), float(np.mean(hsv[:, :, 0][subject]))


def _dark_backdrop_scene() -> np.ndarray:
    """A well-lit orange piece on dark, textured cloth, drawn so no photo file is needed."""
    rng = np.random.default_rng(3)
    image = rng.normal(40, 9, (800, 1200, 3)).clip(0, 255).astype(np.uint8)
    cv2.ellipse(image, (600, 400), (330, 95), 0, 0, 360, (45, 115, 215), -1)
    cv2.ellipse(image, (600, 370), (300, 30), 0, 0, 360, (70, 140, 235), -1)  # highlight
    return image


def test_a_dark_backdrop_does_not_brighten_a_well_lit_product():
    """Regression guard, found by opening the output on 2026-09-14.

    Exposure used to be judged on the whole frame. A red flute on dark fabric was graded
    "too dark", given the maximum gain, and came out pale pink. The product was lit
    correctly; only the cloth was dark.
    """
    image = _dark_backdrop_scene()
    mask = subject_mask(image)
    assert mask.any(), "the scene must have a findable product for this check"

    report = assess(image)
    assert not any("too dark" in line for line in report.guidance)

    result = enhance(image, quality=report)
    assert "exposure_normalization" not in result.transformations
    before_l, before_h = _subject_stats(image, mask)
    after_l, after_h = _subject_stats(result.image, subject_mask(result.image))
    assert abs(after_l - before_l) < 12.0, f"product lightness moved {before_l:.1f} -> {after_l:.1f}"
    assert abs(after_h - before_h) < 20.0, f"product hue moved {before_h:.1f} -> {after_h:.1f}"


@pytest.mark.parametrize("stem", ["good", "off_centre"])
def test_enhancement_preserves_the_products_own_appearance(stem):
    """Regression guard for a bug that every other test in this file missed.

    `_normalise_exposure` used to stretch lightness between percentiles. On the normal
    case -- a dark product on a light backdrop -- that pinned the product at black and
    the backdrop at white, producing a silhouette. The suite stayed green because
    nothing asserted that the subject still looked like itself; only opening the output
    image showed it.

    So this measures the subject region specifically: after enhancement the product
    keeps its own lightness and its own hue. Background work is allowed to be dramatic.
    Work on the product is not.
    """
    original = cv2.imread(str(image_fixture(stem)))
    mask = subject_mask(original)
    assert mask.any()

    result = enhance(image_fixture(stem))
    # Re-locate the subject: enhancement crops, so the masks are not aligned.
    enhanced_mask = subject_mask(result.image)
    assert enhanced_mask.any()

    before_l, before_h = _subject_stats(original, mask)
    after_l, after_h = _subject_stats(result.image, enhanced_mask)

    assert abs(after_l - before_l) < 12.0, (
        f"subject lightness moved {before_l:.1f} -> {after_l:.1f}; "
        "enhancement is altering how the product itself looks"
    )
    assert abs(after_h - before_h) < 20.0, (
        f"subject hue moved {before_h:.1f} -> {after_h:.1f}; "
        "enhancement is changing the product's colour"
    )
