import io

import cv2
import numpy as np
import pytest
from PIL import Image

from app.ai import studio


def _box_mask(degrees, size=(1000, 800), box=(420, 220)):
    mask = np.zeros((size[1], size[0]), np.uint8)
    corners = cv2.boxPoints(((size[0] / 2, size[1] / 2), box, degrees)).astype(np.int32)
    cv2.fillPoly(mask, [corners], 255)
    return mask


def _jpeg(array):
    out = io.BytesIO()
    Image.fromarray(array.astype(np.uint8)).save(out, format="JPEG", quality=95)
    return out.getvalue()


def _scene(background_rgb, product_rgb):
    """A product rectangle in the middle of a plain background, and the matching mask function."""
    image = np.zeros((480, 640, 3)) + background_rgb
    image[140:340, 200:440] = product_rgb
    mask = np.zeros((480, 640), np.uint8)
    mask[140:340, 200:440] = 255
    return _jpeg(image), (lambda img: Image.fromarray(mask).resize(img.size))


def _product_chroma(jpeg_bytes):
    image = np.asarray(Image.open(io.BytesIO(jpeg_bytes)).convert("RGB"))
    lab = cv2.cvtColor(image, cv2.COLOR_RGB2LAB).astype(float)
    h, w = lab.shape[:2]
    centre = lab[h // 2 - 20:h // 2 + 20, w // 2 - 20:w // 2 + 20]
    return centre[..., 1].mean() - 128, centre[..., 2].mean() - 128


@pytest.mark.parametrize("degrees", [-25, -12, -3, 3, 12, 25])
def test_tilted_product_is_levelled(degrees):
    mask = _box_mask(degrees)
    tilt = studio.estimate_tilt(mask)
    levelled = np.asarray(Image.fromarray(mask).rotate(tilt, expand=True))
    contour = studio._largest_contour(studio._binary(levelled))
    (_, _), (w, h), _ = cv2.minAreaRect(contour)
    _, _, bw, bh = cv2.boundingRect(contour)
    assert w * h / (bw * bh) > 0.97


def test_level_round_and_steep_products_are_not_rotated():
    assert studio.estimate_tilt(_box_mask(0)) == 0.0
    assert studio.estimate_tilt(_box_mask(40)) == 0.0  # beyond MAX_LEVEL_ANGLE: treated as intentional
    round_pot = np.zeros((800, 800), np.uint8)
    cv2.circle(round_pot, (400, 400), 250, 255, -1)
    assert studio.estimate_tilt(round_pot) == 0.0


def test_processing_output_is_square_catalogue_jpeg():
    photo, mask_fn = _scene((120, 120, 120), (40, 90, 160))
    result = studio.process_photo(photo, background="white", mask_fn=mask_fn)
    image = Image.open(io.BytesIO(result.image_bytes))
    assert image.format == "JPEG" and image.width == image.height
    assert np.asarray(image.convert("RGB"))[5, 5].min() >= 250  # pure white corner
    assert result.engine == "processing" and not result.human_review_required
    assert result.transformations[0] == "background_neutralization"
    assert "catalogue_background" in result.transformations


def test_coloured_background_is_not_used_for_white_balance():
    # A red product on green cloth: "correcting" the green would turn the product magenta.
    photo, mask_fn = _scene((60, 130, 60), (170, 60, 40))
    result = studio.process_photo(photo, mask_fn=mask_fn)
    assert result.details["white_balance_gains"] == [1.0, 1.0, 1.0]
    assert "white_balance" not in result.transformations


def test_product_hue_is_preserved():
    photo, mask_fn = _scene((110, 110, 110), (150, 70, 45))
    before_a, before_b = _product_chroma(_jpeg(np.zeros((80, 80, 3)) + (150, 70, 45)))
    after_a, after_b = _product_chroma(studio.process_photo(photo, background="white", mask_fn=mask_fn).image_bytes)
    assert np.degrees(abs(np.arctan2(after_b, after_a) - np.arctan2(before_b, before_a))) < 8


def test_empty_mask_asks_for_a_retake():
    photo, _ = _scene((120, 120, 120), (120, 120, 120))
    with pytest.raises(studio.NoProductDetected):
        studio.process_photo(photo, mask_fn=lambda img: Image.new("L", img.size, 0))


def test_ai_edit_that_keeps_the_product_is_accepted(monkeypatch):
    photo, mask_fn = _scene((120, 110, 90), (40, 90, 160))
    edited, _ = _scene((250, 250, 250), (50, 100, 170))  # brighter light, same product
    monkeypatch.setattr(studio, "_generate_ai_edit", lambda image, background: edited)
    result = studio.enhance(photo, engine="ai", mask_fn=mask_fn)
    assert result.engine == "ai"
    assert result.human_review_required
    assert result.details["fidelity"]["passed"]
    assert "generative_edit" in result.transformations


def test_ai_edit_that_recolours_the_product_falls_back(monkeypatch):
    photo, mask_fn = _scene((120, 110, 90), (40, 90, 160))
    recoloured, _ = _scene((250, 250, 250), (180, 60, 40))  # blue product painted red
    monkeypatch.setattr(studio, "_generate_ai_edit", lambda image, background: recoloured)
    result = studio.enhance(photo, engine="ai", mask_fn=mask_fn)
    assert result.engine == "processing"
    assert "colour changed" in result.details["ai_fallback_reason"]
    assert not result.details["ai_fidelity"]["passed"]


def test_ai_quota_error_falls_back_with_readable_reason(monkeypatch):
    photo, mask_fn = _scene((120, 110, 90), (40, 90, 160))

    def quota_exhausted(image, background):
        raise RuntimeError("429 RESOURCE_EXHAUSTED. quota exceeded, limit: 0")

    monkeypatch.setattr(studio, "_generate_ai_edit", quota_exhausted)
    result = studio.enhance(photo, engine="ai", mask_fn=mask_fn)
    assert result.engine == "processing"
    assert "billing" in result.details["ai_fallback_reason"]


def test_unknown_engine_or_background_is_rejected():
    with pytest.raises(ValueError):
        studio.enhance(b"", engine="magic")
    with pytest.raises(ValueError):
        studio.enhance(b"", background="marble")
