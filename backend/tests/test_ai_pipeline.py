import pytest
import json
from unittest.mock import patch, MagicMock
from fastapi import HTTPException
from app.ai.service import ai_service
from app import models

# 1. Bhashini Fallback & Logging Test
@patch("app.ai.bhashini_client.transcribe_audio")
@patch("app.ai.service.gemini_client.transcribe_and_translate")
def test_bhashini_fallback_on_exception(mock_gemini, mock_bhashini, caplog):
    # Simulate Bhashini network failure or unsupported language
    mock_bhashini.side_effect = Exception("Bhashini API Timeout or Unsupported Language")
    
    # Mock the Gemini fallback response
    mock_gemini.return_value = {
        "status": "complete",
        "declared_language": "hi",
        "transcript": "fallback transcript",
        "translated_text": "fallback translation",
        "asr_confidence": 0.94
    }
    
    db_mock = MagicMock()
    mock_listing = models.ListingModel(id="test_listing", preferred_language="hi")
    mock_media = models.MediaAssetModel(id="test_media", url="sample_audio.wav")
    db_mock.query().filter().first.side_effect = [mock_listing, mock_media]
    
    # Execute transcription job
    job = ai_service.create_transcription_job(
        listing_id="test_listing",
        audio_media_id="test_media",
        declared_language="hi",
        db=db_mock
    )
    
    result = json.loads(job.result_data)
    
    # Assertions
    assert "Bhashini ASR failed, using fallback" in caplog.text
    assert result["asr_provider"] == "fallback_fixture"


# 2. Unsupported State Code Test
def test_pricing_unsupported_state_code():
    from app.services.pricing_service import calculate_price
    res = calculate_price(
        material_cost_inr=500.0,
        labour_hours=10.0,
        skill_level="skilled",
        state_code="XX",
    )
    assert res.status == "unavailable"
    assert res.error_code == "WAGE_RATE_UNAVAILABLE"


# 3. Low ASR/Field Confidence Routing Test
@patch("app.ai.service.gemini_client.extract_catalogue_metadata")
def test_catalogue_low_confidence_flagging(mock_extract):
    # Mock Gemini returning a low confidence score for materials
    mock_extract.return_value = {
        "category": "Handicrafts",
        "materials": ["Wood"],
        "field_confidence": {
            "category": 0.95,
            "materials": 0.60  # Low confidence threshold (< 0.85)
        },
        "claims": []
    }
    
    db_mock = MagicMock()
    mock_listing = models.ListingModel(id="test_listing", preferred_language="en")
    db_mock.query().filter().first.return_value = mock_listing
    db_mock.query().filter().order_by().first.return_value = None # No transcription job
    
    result = ai_service.generate_catalogue(
        listing_id="test_listing",
        payload={"transcript": "test transcript"},
        db=db_mock
    )
    
    # Assert 'materials' is pushed to needs_confirmation
    assert "materials" in result.needs_confirmation


# 4. Malformed Gemini JSON Output Test
@patch("app.ai.service.gemini_client.extract_catalogue_metadata")
def test_malformed_gemini_output_fails(mock_extract):
    # Simulate the LLM returning broken JSON that fails parsing
    mock_extract.side_effect = ValueError("Malformed JSON output from LLM")
    
    db_mock = MagicMock()
    mock_listing = models.ListingModel(id="test_listing", preferred_language="en")
    db_mock.query().filter().first.return_value = mock_listing
    db_mock.query().filter().order_by().first.return_value = None
    
    # Assert the pipeline fails loudly instead of silently trusting bad data
    with pytest.raises(ValueError, match="Malformed JSON"):
        ai_service.generate_catalogue(
            listing_id="test_listing",
            payload={"transcript": "test"},
            db=db_mock
        )


# 5. Audio Upload Direct Bytes & Multimodal Fallback Test
@patch("app.ai.bhashini_client.transcribe_audio")
@patch("app.ai.service.gemini_client.transcribe_audio_bytes")
def test_audio_direct_bytes_gemini_multimodal_fallback(mock_gemini_audio, mock_bhashini):
    # Simulate Bhashini failure
    mock_bhashini.side_effect = RuntimeError("Bhashini rate limit exceeded")

    # Mock Gemini multimodal returning real transcribed craft audio
    mock_gemini_audio.return_value = {
        "status": "complete",
        "declared_language": "kn",
        "transcript": "ಇದು ಸಾಂಪ್ರದಾಯಿಕ ಮರದ ಆಟಿಕೆ",
        "translated_text": "This is a traditional wooden toy",
        "asr_confidence": 0.95,
        "detected_language": "kn"
    }

    db_mock = MagicMock()
    mock_listing = models.ListingModel(id="test_listing_audio", preferred_language="kn")
    db_mock.query().filter().first.return_value = mock_listing

    dummy_audio = b"FAKE_AUDIO_DATA_FOR_MULTIMODAL_TEST" * 20  # > 200 bytes

    job = ai_service.create_transcription_job(
        listing_id="test_listing_audio",
        audio_bytes=dummy_audio,
        audio_filename="voice_note.m4a",
        declared_language="kn",
        db=db_mock
    )

    result = json.loads(job.result_data)
    assert result["asr_provider"] == "gemini_multimodal"
    assert result["transcript"] == "ಇದು ಸಾಂಪ್ರದಾಯಿಕ ಮರದ ಆಟಿಕೆ"
    assert result["translated_text"] == "This is a traditional wooden toy"
    assert result["asr_confidence"] == 0.95


# 6. Audio Conversion Utility Test
def test_audio_conversion_to_16k_mono():
    from app.ai.audio_utils import convert_audio_to_wav_16k_mono
    import io
    from pydub import AudioSegment
    from pydub.generators import Sine

    # Generate a stereo 44.1kHz tone
    sine = Sine(440).to_audio_segment(duration=200)
    buf = io.BytesIO()
    sine.export(buf, format="wav")
    raw_wav = buf.getvalue()

    converted = convert_audio_to_wav_16k_mono(raw_wav)
    assert isinstance(converted, bytes)
    assert len(converted) > 0

    # Inspect converted segment
    seg = AudioSegment.from_file(io.BytesIO(converted))
    assert seg.frame_rate == 16000
    assert seg.channels == 1
    assert seg.sample_width == 2


# 7. Bhashini Client Response Parsing Test
@patch("app.ai.bhashini_client.requests.post")
@patch("app.ai.bhashini_client._get_pipeline_config")
def test_bhashini_transcribe_audio_success(mock_config, mock_post):
    from app.ai.bhashini_client import transcribe_audio
    mock_config.return_value = {
        "pipelineResponseConfig": [
            {
                "config": [
                    {
                        "language": {"sourceLanguage": "kn"},
                        "serviceId": "bhashini_asr_kn"
                    }
                ]
            }
        ],
        "pipelineInferenceAPIEndPoint": {
            "callbackUrl": "https://bhashini.example.com/infer",
            "inferenceApiKey": {"name": "Authorization", "value": "test_token"}
        }
    }
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "pipelineResponse": [
            {
                "output": [
                    {"source": "ಇದು ಸಾಂಪ್ರದಾಯಿಕ ಕರಕುಶಲ ವಸ್ತು"}
                ]
            }
        ]
    }
    mock_post.return_value = mock_response

    result = transcribe_audio(b"FAKE_WAV_BYTES", source_language="kn")
    assert result == "ಇದು ಸಾಂಪ್ರದಾಯಿಕ ಕರಕುಶಲ ವಸ್ತು"