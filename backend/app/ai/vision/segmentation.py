"""
Subject segmentation: which pixels are the product.

Framing grades (is the product large enough, is it centred) and the studio's background
work both depend on this mask. The first version separated subject from background by
colour distance from the frame border, thresholded with Otsu. `AI_MERGE_NOTES.md`
recorded it as visibly wrong on real photographs, and its tests could not notice,
because they took "the subject" from the same mask they were checking.

This uses rembg's salient-object models through onnxruntime. Measured 2026-09-14
against scenes whose true mask is known because it was drawn
(`fixtures/segmentation_scenes.py`), intersection over union with that mask:

    scene                        colour distance   u2netp   u2net   isnet-general-use
    vessel on striped cloth           0.49          0.97     0.98        0.98
    beige pot on beige cloth          0.18          0.99     0.99        1.00
    strong cast shadow                0.71          1.00     1.00        1.00

`u2netp` is the default: a 4.6 MB model at about 0.2 s per photo on a laptop CPU,
against 176-179 MB and 0.4-1.1 s for the larger two, for an IoU difference of at most
0.01 on these scenes. The scenes are drawn, not photographed: they show the old mask
failing where it was expected to fail, and are not evidence about real workshop
photographs. The consented evaluation set decides that.

The model file downloads on first use into rembg's cache (~/.rembg). Repeated runs on
the same bytes gave identical masks.
"""

from __future__ import annotations

import functools

import cv2
import numpy as np

from ..contracts import AIError, ErrorCode

# rembg returns a 0..255 soft mask. Above the midpoint counts as product.
ALPHA_THRESHOLD = 127


def model_name() -> str:
    from .. import config

    return config.segmentation_model()


@functools.lru_cache(maxsize=2)
def _session(name: str):
    # Cached: loading the model is the slow part. lru_cache does not cache exceptions,
    # so a failed load is retried on the next photo.
    try:
        from rembg import new_session
    except ImportError as exc:
        raise AIError(
            ErrorCode.PROVIDER_UNAVAILABLE,
            "Subject segmentation is not installed (pip install -r requirements-ai.txt).",
            recoverable=False,
        ) from exc
    try:
        return new_session(name, providers=["CPUExecutionProvider"])
    except Exception as exc:  # noqa: BLE001 - download and model errors become contract errors
        raise AIError(
            ErrorCode.PROVIDER_UNAVAILABLE,
            f"Segmentation model {name!r} could not be loaded: {exc}",
            recoverable=False,
        ) from exc


def subject_mask(image: np.ndarray) -> np.ndarray:
    """uint8 mask the size of `image` (BGR uint8), 255 where the product is."""
    from rembg import remove

    session = _session(model_name())
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    alpha = np.asarray(remove(rgb, session=session, only_mask=True))
    if alpha.ndim == 3:
        alpha = alpha[:, :, 0]
    height, width = image.shape[:2]
    if alpha.shape != (height, width):
        alpha = cv2.resize(alpha, (width, height), interpolation=cv2.INTER_LINEAR)
    return np.where(alpha > ALPHA_THRESHOLD, 255, 0).astype(np.uint8)


__all__ = ["ALPHA_THRESHOLD", "model_name", "subject_mask"]
