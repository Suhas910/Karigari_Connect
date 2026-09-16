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


def predict_mask(image: Image.Image) -> Image.Image:
    """Foreground mask ('L' mode, same size as the image) predicted by BiRefNet."""
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

    return transforms.functional.to_pil_image(prediction).resize(image.size, Image.BILINEAR)


def enhance_product_photo(image_bytes: bytes) -> bytes:
    """Remove the background from a product photo and return it as a JPEG on white."""
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    mask = predict_mask(image)

    studio = Image.new("RGB", image.size, BACKGROUND_COLOUR)
    studio.paste(image, mask=mask)

    out = io.BytesIO()
    studio.save(out, format="JPEG", quality=92)
    return out.getvalue()
