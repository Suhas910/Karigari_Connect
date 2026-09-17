# backend/app/ai/bhashini_client.py
import os
import base64
import time
import requests
from typing import Optional, Dict, Any
from dotenv import load_dotenv

load_dotenv()

DISCOVERY_URL = "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline"

_DISCOVERY_CACHE: Optional[Dict[str, Any]] = None
_CACHE_TIMESTAMP: float = 0.0
CACHE_TTL_SECONDS: int = 3600

def _get_pipeline_config() -> Dict[str, Any]:
    global _DISCOVERY_CACHE, _CACHE_TIMESTAMP
    current_time = time.time()

    if _DISCOVERY_CACHE and (current_time - _CACHE_TIMESTAMP < CACHE_TTL_SECONDS):
        return _DISCOVERY_CACHE

    user_id = os.getenv("BHASHINI_USER_ID")
    api_key = os.getenv("BHASHINI_API_KEY")

    if not user_id or not api_key:
        raise ValueError("Missing BHASHINI_USER_ID or BHASHINI_API_KEY in environment variables.")

    discovery_payload = {
        "pipelineTasks": [{"taskType": "asr"}],
        "pipelineRequestConfig": {"pipelineId": "64392f96daac500b55c543cd"}
    }
    discovery_headers = {
        "userID": user_id,
        "ulcaApiKey": api_key,
        "Content-Type": "application/json"
    }

    response = requests.post(DISCOVERY_URL, json=discovery_payload, headers=discovery_headers, timeout=15)
    response.raise_for_status()
    _DISCOVERY_CACHE = response.json()
    _CACHE_TIMESTAMP = current_time
    return _DISCOVERY_CACHE

def transcribe_audio(audio_bytes: bytes, source_language: str = "hi") -> str:
    """
    Performs cached Bhashini pipeline resolution and executes ASR transcription.
    """
    disc_data = _get_pipeline_config()

    asr_configs = disc_data["pipelineResponseConfig"][0]["config"]
    service_id = None

    for config in asr_configs:
        lang_code = config.get("language", {}).get("sourceLanguage", "")
        if lang_code == source_language:
            service_id = config.get("serviceId")
            break

    if not service_id:
        raise ValueError(f"No Bhashini ASR service found for source language: '{source_language}'")

    endpoint_info = disc_data["pipelineInferenceAPIEndPoint"]
    inference_url = endpoint_info["callbackUrl"]
    auth_header_name = endpoint_info["inferenceApiKey"]["name"]
    auth_header_val = endpoint_info["inferenceApiKey"]["value"]

    audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
    inference_payload = {
        "pipelineTasks": [{
            "taskType": "asr",
            "config": {
                "language": {"sourceLanguage": source_language},
                "serviceId": service_id,
                "audioFormat": "wav",
                "samplingRate": 16000
            }
        }],
        "inputData": {"audio": [{"audioContent": audio_base64}]}
    }
    inference_headers = {
        "Content-Type": "application/json",
        auth_header_name: auth_header_val
    }

    inf_res = requests.post(inference_url, json=inference_payload, headers=inference_headers, timeout=30)
    if inf_res.status_code != 200:
        raise RuntimeError(f"Bhashini API Error ({inf_res.status_code}): {inf_res.text}")
    inf_data = inf_res.json()

    return inf_data["pipelineResponse"][0]["output"][0]["source"]