"""
Drawn scenes whose true subject mask is known, for testing segmentation.

Each scene is painted from a mask, so the mask is an input to the picture rather than
something computed from it. That is the property the previous tests lacked: they took
"the subject" from the mask under test.

The scenes are chosen to break a colour-distance mask: a patterned backdrop, a product
the same colour as its backdrop, and a strong cast shadow. They are synthetic and must
never be shown as craft photographs. Generated in memory with a fixed seed; nothing is
written to disk.
"""

from __future__ import annotations

import functools

import cv2
import numpy as np

from .generate_image_fixtures import SEED, SIZE, _woven_panel

WIDTH, HEIGHT = SIZE

SCENE_NAMES = (
    "vessel_on_striped_cloth",
    "beige_pot_on_beige_cloth",
    "strong_cast_shadow",
    "second_object_at_edge",
    "woven_panel_on_similar_backdrop",
)


def _striped_cloth(rng: np.random.Generator) -> np.ndarray:
    ys, xs = np.mgrid[0:HEIGHT, 0:WIDTH].astype(np.float32)
    stripes = ((xs + ys * 0.35) // 70 % 3).astype(int)
    palette = np.array([[0.20, 0.45, 0.85], [0.75, 0.70, 0.30], [0.35, 0.25, 0.20]], dtype=np.float32)
    cloth = palette[stripes] * (0.9 + 0.1 * np.sin(xs * 0.8))[:, :, None]
    return np.clip(cloth + rng.normal(0, 0.02, (HEIGHT, WIDTH, 1)), 0, 1).astype(np.float32)


def _plain(rng: np.random.Generator, bgr: list[float]) -> np.ndarray:
    base = np.ones((HEIGHT, WIDTH, 3), np.float32) * np.array(bgr, np.float32)
    shade = np.linspace(1.03, 0.93, HEIGHT, dtype=np.float32)[:, None, None]
    return np.clip(base * shade + rng.normal(0, 0.012, (HEIGHT, WIDTH, 1)), 0, 1).astype(np.float32)


def _vessel_mask(cx: int, cy: int, scale: float) -> np.ndarray:
    """A pot silhouette: body, neck and rim."""
    mask = np.zeros((HEIGHT, WIDTH), np.uint8)
    cv2.ellipse(mask, (cx, cy + int(60 * scale)), (int(230 * scale), int(250 * scale)), 0, 0, 360, 255, -1)
    cv2.rectangle(mask, (cx - int(95 * scale), cy - int(260 * scale)), (cx + int(95 * scale), cy - int(120 * scale)), 255, -1)
    cv2.ellipse(mask, (cx, cy - int(262 * scale)), (int(135 * scale), int(34 * scale)), 0, 0, 360, 255, -1)
    return mask


def _paint_vessel(canvas, mask, colour, rng, shadow_offset=(0, 0), shadow_strength=0.0):
    m = mask.astype(np.float32) / 255
    if shadow_strength:
        dx, dy = shadow_offset
        shifted = np.roll(np.roll(m, dy, axis=0), dx, axis=1)
        shadow = cv2.GaussianBlur(shifted, (0, 0), 14) * (1 - m)
        canvas = canvas * (1 - shadow_strength * shadow[:, :, None])
    ys, xs = np.mgrid[0:HEIGHT, 0:WIDTH].astype(np.float32)
    shading = 0.75 + 0.35 * np.cos((xs - xs[m > 0].mean()) / 260.0)
    texture = 1 + 0.06 * np.sin(ys * 0.5) + rng.normal(0, 0.02, (HEIGHT, WIDTH))
    body = np.array(colour, np.float32)[None, None, :] * (shading * texture)[:, :, None]
    return np.clip(canvas * (1 - m[:, :, None]) + body * m[:, :, None], 0, 1)


def _u8(image: np.ndarray) -> np.ndarray:
    return np.clip(image * 255.0, 0, 255).astype(np.uint8)


@functools.lru_cache(maxsize=1)
def _build() -> dict[str, tuple[np.ndarray, np.ndarray]]:
    rng = np.random.default_rng(SEED)
    out: dict[str, tuple[np.ndarray, np.ndarray]] = {}

    mask = _vessel_mask(WIDTH // 2, HEIGHT // 2 + 40, 1.3)
    out["vessel_on_striped_cloth"] = (_paint_vessel(_striped_cloth(rng), mask, [0.25, 0.42, 0.70], rng), mask)

    mask = _vessel_mask(WIDTH // 2, HEIGHT // 2 + 40, 1.3)
    out["beige_pot_on_beige_cloth"] = (_paint_vessel(_plain(rng, [0.62, 0.72, 0.80]), mask, [0.52, 0.64, 0.76], rng), mask)

    mask = _vessel_mask(WIDTH // 2 - 80, HEIGHT // 2 + 40, 1.2)
    out["strong_cast_shadow"] = (
        _paint_vessel(_plain(rng, [0.80, 0.82, 0.84]), mask, [0.20, 0.30, 0.55], rng, shadow_offset=(160, 40), shadow_strength=0.75),
        mask,
    )

    mask = _vessel_mask(WIDTH // 2, HEIGHT // 2 + 40, 1.1)
    canvas = _plain(rng, [0.78, 0.80, 0.82])
    cv2.rectangle(canvas, (0, 700), (260, HEIGHT), (0.15, 0.15, 0.15), -1)  # another object at the edge
    out["second_object_at_edge"] = (_paint_vessel(canvas, mask, [0.30, 0.45, 0.65], rng), mask)

    panel = _woven_panel(int(WIDTH * 0.55), int(HEIGHT * 0.45), rng)
    canvas = _plain(rng, [0.55, 0.60, 0.75])
    panel_h, panel_w = panel.shape[:2]
    x0, y0 = WIDTH // 2 - panel_w // 2, HEIGHT // 2 - panel_h // 2
    canvas[y0:y0 + panel_h, x0:x0 + panel_w] = panel
    mask = np.zeros((HEIGHT, WIDTH), np.uint8)
    mask[y0:y0 + panel_h, x0:x0 + panel_w] = 255
    out["woven_panel_on_similar_backdrop"] = (canvas, mask)

    return {name: (_u8(image), mask) for name, (image, mask) in out.items()}


def scenes() -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """{name: (BGR uint8 image, uint8 true mask)}. Copies, so tests cannot alter the cache."""
    return {name: (image.copy(), mask.copy()) for name, (image, mask) in _build().items()}


__all__ = ["SCENE_NAMES", "scenes"]
