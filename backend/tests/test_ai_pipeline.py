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
    db_mock = MagicMock()
    mock_listing = models.ListingModel(id="test_listing")
    db_mock.query().filter().first.return_value = mock_listing
    
    # Attempt to calculate price with an invalid state code "XX"
    with pytest.raises(HTTPException) as exc_info:
        ai_service.calculate_fair_price(
            listing_id="test_listing",
            material_cost_paise=50000,
            labour_hours=10.0,
            skill_level="skilled",
            state_code="XX", 
            db=db_mock
        )
    
    # Assert HTTP 422 and correct error code
    assert exc_info.value.status_code == 422
    assert exc_info.value.detail["code"] == "WAGE_RATE_UNAVAILABLE"


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