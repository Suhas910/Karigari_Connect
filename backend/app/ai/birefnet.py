# backend/app/ai/birefnet.py
"""
Product photo enhancement with BiRefNet (https://huggingface.co/ZhengPeng7/BiRefNet).

BiRefNet predicts a foreground mask; the product is cut out along that mask and placed on a
plain white background, which is what marketplace catalogues expect. The model is loaded
lazily on first use (about 900 MB of weights are downloaded into the Hugging Face cache the
first time) and then kept in memory for later requests.
"""
import io
import os
import logging
import threading
import warnings

# Suppress noisy third-party warnings that confuse operators:
# - torch.jit.script FutureWarning (comes from BiRefNet internals, harmless)
# - HF Hub unauthenticated warning (public model, no token needed)
warnings.filterwarnings("ignore", message=".*torch.jit.script.*is deprecated.*", category=FutureWarning)
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

import cv2
import numpy as np
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

MODEL_ID = os.getenv("BIREFNET_MODEL", "ZhengPeng7/BiRefNet")
INPUT_SIZE = (1024, 1024)
BACKGROUND_COLOUR = (255, 255, 255)

_model = None
_device = None
# One model instance, one inference at a time: keeps memory bounded and the model thread-safe.
_lock = threading.Lock()


class BiRefNetUnavailable(RuntimeError):
    """The BiRefNet dependencies or weights could not be loaded."""


def _load_model():
    global _model, _device
    if _model is not None:
        return _model, _device

    try:
        import torch
        from transformers import AutoModelForImageSegmentation
    except ImportError as exc:
        raise BiRefNetUnavailable(
            "BiRefNet needs torch, torchvision, transformers, timm, kornia and einops "
            "(pip install -r requirements.txt)."
        ) from exc

    if torch.cuda.is_available():
        device = "cuda"
    elif torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"

    try:
        model = AutoModelForImageSegmentation.from_pretrained(MODEL_ID, trust_remote_code=True)
    except Exception as exc:
        raise BiRefNetUnavailable(f"Could not load BiRefNet model '{MODEL_ID}': {exc}") from exc

    # The published weights load as float16; inputs are float32, and float16 convolutions are not supported on every CPU.
    model.to(device).float().eval()
    logger.info("Loaded BiRefNet model %s on %s", MODEL_ID, device)
    _model, _device = model, device
    return _model, _device


def predict_mask_opencv(image: Image.Image, force_foreground: bool = False) -> Image.Image:
    """
    Deterministic foreground segmentation using OpenCV GrabCut with adaptive bounding box.
    Used as an efficient, offline fallback when BiRefNet neural weights are unavailable,
    or when deep learning inference encounters issues.
    """
    orig_w, orig_h = image.size

    # Scale to working resolution (max 512px) for speed (< 100ms)
    max_side = 512
    scale = min(1.0, max_side / max(orig_w, orig_h))
    work_w = max(16, int(orig_w * scale))
    work_h = max(16, int(orig_h * scale))

    small_img = image.resize((work_w, work_h), Image.BILINEAR)
    img_np = np.array(small_img.convert("RGB"))
    bgr = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)

    # Define bounding box assuming product is centered within an 8% frame margin
    margin_x = max(2, int(work_w * 0.08))
    margin_y = max(2, int(work_h * 0.08))
    rect = (margin_x, margin_y, max(1, work_w - 2 * margin_x), max(1, work_h - 2 * margin_y))

    mask = np.zeros((work_h, work_w), np.uint8)
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)

    try:
        cv2.grabCut(bgr, mask, rect, bgd_model, fgd_model, iterCount=4, mode=cv2.GC_INIT_WITH_RECT)
        binary = np.where((mask == 1) | (mask == 3), 255, 0).astype(np.uint8)
    except Exception as err:
        logger.warning("GrabCut computation failed (%s), using margin box", err)
        binary = np.zeros((work_h, work_w), np.uint8)
        binary[margin_y:work_h - margin_y, margin_x:work_w - margin_x] = 255

    fg_fraction = (binary > 0).mean()
    if fg_fraction < 0.02 or fg_fraction > 0.95 or force_foreground:
        # Fallback to color contrast against border background
        border_pixels = np.concatenate([
            img_np[:margin_y, :],
            img_np[-margin_y:, :],
            img_np[:, :margin_x],
            img_np[:, -margin_x:]
        ], axis=None).reshape(-1, 3)
        bg_color = np.median(border_pixels, axis=0)
        dist = np.linalg.norm(img_np.astype(float) - bg_color.astype(float), axis=2)
        thresh = np.percentile(dist, 60)
        binary_contrast = np.where(dist > max(thresh, 18.0), 255, 0).astype(np.uint8)
        if (binary_contrast > 0).mean() >= 0.02:
            binary = binary_contrast
        else:
            # Centered ellipse mask to retain product core
            binary = np.zeros((work_h, work_w), np.uint8)
            cv2.ellipse(
                binary,
                (work_w // 2, work_h // 2),
                (int(work_w * 0.38), int(work_h * 0.38)),
                0, 0, 360, 255, -1
            )

    # Clean up mask with morphology
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=1)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=1)

    # Fill holes in the largest contour
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        largest = max(contours, key=cv2.contourArea)
        cv2.drawContours(binary, [largest], -1, 255, -1)

    # Edge softening
    binary = cv2.GaussianBlur(binary, (5, 5), 1.0)
    return Image.fromarray(binary).resize((orig_w, orig_h), Image.BILINEAR)


def predict_mask(image: Image.Image) -> Image.Image:
    """Foreground mask ('L' mode, same size as the image) predicted by BiRefNet with OpenCV GrabCut fallback."""
    try:
        import torch
        from torchvision import transforms

        preprocess = transforms.Compose([
            transforms.Resize(INPUT_SIZE),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])

        with _lock:
            model, device = _load_model()
            batch = preprocess(image).unsqueeze(0).to(device)
            with torch.no_grad():
                prediction = model(batch)[-1].sigmoid().cpu()[0].squeeze()

        mask = transforms.functional.to_pil_image(prediction).resize(image.size, Image.BILINEAR)
        mask_np = np.asarray(mask)
        if (mask_np >= 128).mean() < 0.01:
            logger.warning("BiRefNet predicted near-empty mask. Falling back to OpenCV GrabCut.")
            return predict_mask_opencv(image)
        return mask
    except Exception as exc:
        logger.warning("BiRefNet prediction unavailable or failed (%s). Falling back to OpenCV GrabCut.", exc)
        return predict_mask_opencv(image)


def enhance_product_photo(image_bytes: bytes) -> bytes:
    """Remove the background from a product photo and return it as a JPEG on white."""
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    mask = predict_mask(image)

    studio = Image.new("RGB", image.size, BACKGROUND_COLOUR)
    studio.paste(image, mask=mask)

    out = io.BytesIO()
    studio.save(out, format="JPEG", quality=92)
    return out.getvalue()

