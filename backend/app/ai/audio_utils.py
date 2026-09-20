# backend/app/ai/audio_utils.py
import io
import logging
from typing import Optional
from pydub import AudioSegment

logger = logging.getLogger(__name__)

def convert_audio_to_wav_16k_mono(audio_bytes: bytes) -> bytes:
    """
    Converts audio bytes (e.g. .m4a, .mp4, .mp3, .wav) to 16kHz mono 16-bit PCM WAV.
    This is required by Bhashini ULCA ASR pipeline (audioFormat: "wav", samplingRate: 16000).
    """
    if not audio_bytes:
        return audio_bytes
    try:
        segment = AudioSegment.from_file(io.BytesIO(audio_bytes))
        # Enforce 60-second maximum limit (with 2s grace)
        if len(segment) > 62000:
            logger.info("Audio duration %d ms exceeds 60s limit; clipping to 60,000 ms", len(segment))
            segment = segment[:60000]

        # Ensure 16kHz, mono (1 channel), 16-bit PCM (sample_width=2)
        segment = segment.set_frame_rate(16000).set_channels(1).set_sample_width(2)
        out_buf = io.BytesIO()
        segment.export(out_buf, format="wav")
        converted = out_buf.getvalue()
        logger.info(
            "Successfully converted audio to 16kHz mono WAV: in_bytes=%d, out_bytes=%d, duration_ms=%d",
            len(audio_bytes),
            len(converted),
            len(segment)
        )
        return converted
    except Exception as e:
        logger.warning(f"Audio conversion to 16kHz mono WAV failed: {e}. Falling back to original bytes.")
        return audio_bytes
