"""
Validate uploaded media by its bytes, not by what the client says it is.

The multipart `Content-Type` and the filename are claims made by the sender. A text file
renamed `photo.jpg` carries both. So images are decoded with Pillow, and audio is
identified by its container signature. Only then is anything stored.

Photos also lose their embedded metadata here. A phone photo's EXIF block can hold GPS
coordinates, a device serial and a timestamp; on a listing that reaches a buyer, that is
the artisan's home location. Pixels and the colour profile are kept.

Audio is checked for its container only. Whether the recording is intelligible is the
speech step's job, and it reports that as ASR_LOW_CONFIDENCE, not as an upload failure.
"""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass, field

from PIL import Image, ImageOps, UnidentifiedImageError

# Mirrored in `upload_instructions` on listing creation, which reads these names, so the
# limits the app is told about and the limits enforced cannot drift apart.
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_AUDIO_BYTES = 20 * 1024 * 1024
ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"]
ALLOWED_AUDIO_TYPES = ["audio/wav", "audio/m4a", "audio/mp4", "audio/aac"]

_IMAGE_FORMATS = {
    "JPEG": ("image/jpeg", ".jpg"),
    "PNG": ("image/png", ".png"),
    "WEBP": ("image/webp", ".webp"),
}
_METADATA_INFO_KEYS = ("exif", "xmp", "XML:com.adobe.xmp", "comment")
_ORIENTATION_TAG = 0x0112


class MediaRejected(Exception):
    """The bytes are not media this service accepts. The message is safe to show."""


@dataclass(frozen=True)
class InspectedMedia:
    data: bytes  # what to store; differs from the upload only when metadata was stripped
    content_type: str
    extension: str
    metadata: dict = field(default_factory=dict)


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalise_checksum(raw: str | None) -> str | None:
    """Accept `sha256:<hex>` or bare `<hex>`; return bare lowercase hex, or None."""
    if not raw or not raw.strip():
        return None
    value = raw.strip().lower()
    return value[len("sha256:"):] if value.startswith("sha256:") else value


def _has_metadata(image: Image.Image) -> bool:
    if len(image.getexif()):
        return True
    if any(key in image.info for key in _METADATA_INFO_KEYS):
        return True
    return bool(getattr(image, "text", None))  # PNG tEXt/iTXt chunks


def _strip_metadata(image: Image.Image, fmt: str) -> bytes:
    orientation = image.getexif().get(_ORIENTATION_TAG, 1)
    icc = image.info.get("icc_profile")
    upright = orientation in (None, 1)
    out_image = image if upright else ImageOps.exif_transpose(image)
    # Pillow reads some save defaults from `info`. Clearing it is what guarantees the
    # metadata is not carried into the new file.
    out_image.info = {}
    options = {"icc_profile": icc} if icc else {}

    out = io.BytesIO()
    if fmt == "JPEG":
        if upright:
            # Reuses the original quantisation tables and subsampling, so the re-save is
            # as close to lossless as JPEG allows.
            out_image.save(out, "JPEG", quality="keep", subsampling="keep", **options)
        else:
            # Rotation changes the pixel grid, so the original tables no longer apply.
            out_image.save(out, "JPEG", quality=95, **options)
    elif fmt == "PNG":
        out_image.save(out, "PNG", **options)
    else:
        out_image.save(out, "WEBP", quality=95, **options)
    return out.getvalue()


def inspect_image(data: bytes) -> InspectedMedia:
    if not data:
        raise MediaRejected("The photo is empty.")
    try:
        with Image.open(io.BytesIO(data)) as probe:
            fmt = probe.format
            probe.verify()
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError) as exc:
        raise MediaRejected("This file is not a readable JPEG, PNG or WebP photo.") from exc
    if fmt not in _IMAGE_FORMATS:
        raise MediaRejected("Only JPEG, PNG or WebP photos are accepted.")

    # verify() leaves the image unusable, so decode again, fully this time, which is
    # what catches a file truncated mid-transfer.
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise MediaRejected("This photo is damaged or incomplete.") from exc

    content_type, extension = _IMAGE_FORMATS[fmt]
    stripped = _has_metadata(image)
    stored = _strip_metadata(image, fmt) if stripped else data
    width, height = Image.open(io.BytesIO(stored)).size if stripped else image.size

    return InspectedMedia(
        data=stored,
        content_type=content_type,
        extension=extension,
        metadata={
            "format": fmt.lower(),
            "width": width,
            "height": height,
            "metadata_stripped": stripped,
        },
    )


def inspect_audio(data: bytes) -> InspectedMedia:
    if len(data) < 12:
        raise MediaRejected("The voice recording is empty or incomplete.")

    if data[0:4] == b"RIFF" and data[8:12] == b"WAVE":
        content_type, extension, meta = "audio/wav", ".wav", {"container": "wav"}
    elif data[4:8] == b"ftyp":
        # MP4 family. expo-audio records .m4a (AAC in MP4) on both iOS and Android.
        brand = data[8:12].decode("latin-1").strip()
        content_type, extension, meta = "audio/mp4", ".m4a", {"container": "mp4", "brand": brand}
    elif data[0] == 0xFF and (data[1] & 0xF6) == 0xF0:
        # ADTS sync word (12 set bits) with layer 00, which is how raw AAC is framed.
        content_type, extension, meta = "audio/aac", ".aac", {"container": "adts"}
    else:
        raise MediaRejected("This file is not a WAV, M4A or AAC voice recording.")

    return InspectedMedia(data=data, content_type=content_type, extension=extension, metadata=meta)
