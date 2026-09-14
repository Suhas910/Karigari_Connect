"""
Subject segmentation, checked against masks known because they were drawn.

The previous mask's tests took "the subject" from the mask being tested, so a wrong mask
passed. Here the true mask is an input to each scene. Runs the real model; the first run
downloads it (4.6 MB for u2netp).
"""

from __future__ import annotations

import numpy as np
import pytest

from app.ai.fixtures.segmentation_scenes import SCENE_NAMES, scenes
from app.ai.vision.segmentation import subject_mask

# Measured minimum for u2netp on these scenes was 0.97 (see vision/segmentation.py).
# Set below that so model or library updates that shift edges by a few pixels still pass,
# while a mask that picks up the backdrop, as the colour-distance mask did (0.18-0.71), fails.
MIN_IOU = 0.90


def _iou(predicted: np.ndarray, truth: np.ndarray) -> float:
    p, t = predicted > 127, truth > 127
    union = np.logical_or(p, t).sum()
    return float(np.logical_and(p, t).sum() / union) if union else 1.0


@pytest.mark.parametrize("scene", SCENE_NAMES)
def test_mask_matches_the_drawn_outline(scene):
    image, truth = scenes()[scene]
    assert _iou(subject_mask(image), truth) >= MIN_IOU


def test_same_photo_same_mask():
    image, _ = scenes()["vessel_on_striped_cloth"]
    np.testing.assert_array_equal(subject_mask(image), subject_mask(image))


def test_mask_is_the_size_of_the_photo():
    image, _ = scenes()["strong_cast_shadow"]
    mask = subject_mask(image[:500, :700])
    assert mask.shape == (500, 700)
    assert set(np.unique(mask)) <= {0, 255}


def test_scene_masks_are_not_shared_between_calls():
    first = scenes()["beige_pot_on_beige_cloth"][1]
    first[:] = 0
    assert scenes()["beige_pot_on_beige_cloth"][1].any()
