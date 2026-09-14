"""
Photo quality assessor.

Each test names the defect its fixture carries, so a failure says which measurement
regressed rather than only that something did.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from app.ai.fixtures.segmentation_scenes import scenes
from app.ai.vision.quality import assess, measure

from .conftest import image_fixture


def _jpeg(image: np.ndarray, quality: int) -> np.ndarray:
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    assert ok
    return cv2.imdecode(encoded, cv2.IMREAD_COLOR)


@pytest.mark.parametrize("quality", [92, 70])
def test_jpeg_compression_does_not_change_the_blur_grade(quality):
    """Regression guard, measured 2026-09-14.

    Phone photos are JPEGs, and JPEG's block edges read as detail once real detail is
    blurred away. Measured at 1024 px, a blurred scene saved at quality 70 crossed into
    "acceptable". Sharpness is now measured at 512 px (see quality.py).
    """
    scene = scenes()["vessel_on_striped_cloth"][0]
    assert assess(_jpeg(cv2.GaussianBlur(scene, (0, 0), 6), quality)).blur != "acceptable"
    assert assess(_jpeg(scene, quality)).blur == "acceptable"
    assert assess(_jpeg(cv2.imread(str(image_fixture("blurred"))), quality)).blur == "unacceptable"


def test_good_photo_passes_every_dimension():
    report = assess(image_fixture("good"))
    assert report.overall == "acceptable"
    assert (report.blur, report.lighting, report.framing) == ("acceptable",) * 3
    assert report.guidance == []


@pytest.mark.parametrize(
    "stem,dimension,expected",
    [
        ("blurred", "blur", "unacceptable"),
        ("low_resolution", "blur", "unacceptable"),
        ("underexposed", "lighting", "needs_correction"),
        ("overexposed", "lighting", "unacceptable"),
        ("subject_too_small", "framing", "unacceptable"),
        ("off_centre", "framing", "needs_correction"),
    ],
)
def test_each_defect_is_caught_on_its_own_dimension(stem, dimension, expected):
    report = assess(image_fixture(stem))
    assert getattr(report, dimension) == expected
    assert report.guidance, "a graded-down photo must always come with a retake instruction"


def test_darkness_is_not_reported_as_blur():
    """Regression guard.

    Variance of the Laplacian scales with contrast, so a dark-but-sharp photo grades as
    blurred unless sharpness is measured on an exposure-normalised copy. Getting this
    wrong tells an artisan in a dim workshop to hold the phone steadier, which will not
    help and will cost their trust in the advice.
    """
    report = assess(image_fixture("underexposed"))
    assert report.blur == "acceptable"
    assert report.lighting == "needs_correction"


def test_guidance_names_the_right_remedy():
    """Opposite problems must not get the same instruction."""
    dark = " ".join(assess(image_fixture("underexposed")).guidance).lower()
    bright = " ".join(assess(image_fixture("overexposed")).guidance).lower()
    assert "too dark" in dark and "too strong" not in dark
    assert "too strong" in bright and "too dark" not in bright


def test_guidance_is_addressed_to_the_artisan_not_the_developer():
    """No metric names, no jargon. `AI_INTERFACE_CONTRACTS.md` forbids raw model errors."""
    banned = ("laplacian", "variance", "luma", "threshold", "px", "frac", "confidence")
    for stem in ("blurred", "underexposed", "overexposed", "subject_too_small", "off_centre"):
        for line in assess(image_fixture(stem)).guidance:
            assert not any(word in line.lower() for word in banned), line


def test_assessment_is_deterministic():
    """Same bytes, same verdict. The whole approach depends on this."""
    first = assess(image_fixture("off_centre"))
    second = assess(image_fixture("off_centre"))
    assert first.model_dump() == second.model_dump()


def test_metrics_are_always_reported_alongside_the_grade():
    """Thresholds are provisional, so the raw numbers must travel with the verdict."""
    report = assess(image_fixture("good"))
    for key in ("blur_laplacian_var", "mean_luma", "subject_area_frac", "long_edge_px"):
        assert key in report.metrics


def test_blank_frame_does_not_crash():
    """A lens cap, a black frame, a wall. No subject separates; the code must cope."""
    report = assess(np.full((800, 1000, 3), 128, dtype=np.uint8))
    assert report.overall == "unacceptable"
    assert report.guidance
