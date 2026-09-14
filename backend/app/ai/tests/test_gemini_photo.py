"""
Gemini photo check, against a fake client.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from google.genai import errors

from app.ai.adapters import GeminiPhotoCheck
from app.ai.adapters.gemini_photo import ISSUES, PROMPT, RESPONSE_SCHEMA
from app.ai.contracts import AIError, ErrorCode

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


class _Models:
    def __init__(self, outcome):
        self.outcome = outcome
        self.calls = []

    def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def _check(outcome):
    models = _Models(outcome)
    return GeminiPhotoCheck(client=SimpleNamespace(models=models), model="gemini-3.5-flash"), models


def _reply(issues):
    return SimpleNamespace(text=json.dumps({"issues": issues}), model_version="gemini-3.5-flash")


def test_sends_the_photo_bytes_with_a_fixed_question():
    check, models = _check(_reply([]))
    check.check(JPEG, "image/jpeg")

    call = models.calls[0]
    assert call["contents"][0].inline_data.data == JPEG
    assert call["contents"][0].inline_data.mime_type == "image/jpeg"
    assert call["contents"][1] == PROMPT
    assert call["config"].response_json_schema == RESPONSE_SCHEMA
    assert "sharpness" in PROMPT  # told not to grade what the measurement grades


def test_no_issues_is_acceptable_with_no_guidance():
    result = _check(_reply([]))[0].check(JPEG, "image/jpeg")
    assert (result.issues, result.level, result.guidance) == ([], "acceptable", [])
    assert result.adapter.provider == "gemini"


def test_issues_are_deduplicated_and_guidance_is_ours():
    result = _check(_reply(["person_visible", "no_product_visible", "person_visible"]))[0].check(JPEG, "image/jpeg")
    assert result.issues == ["person_visible", "no_product_visible"]
    assert result.level == "needs_correction"
    assert result.guidance == [ISSUES["person_visible"][1], ISSUES["no_product_visible"][1]]


def test_the_model_alone_can_never_refuse_a_photo():
    """Only a measurement makes a photo unacceptable. See the module docstring for why."""
    assert all(level != "unacceptable" for level, _ in ISSUES.values())
    result = _check(_reply(list(ISSUES)))[0].check(JPEG, "image/jpeg")
    assert result.level == "needs_correction"


@pytest.mark.parametrize("text", ["not json", None, json.dumps({"issues": ["blurry"]}), json.dumps({"issues": "none"})])
def test_unreadable_or_off_list_answers_are_errors(text):
    with pytest.raises(AIError) as excinfo:
        _check(SimpleNamespace(text=text, model_version=None))[0].check(JPEG, "image/jpeg")
    assert excinfo.value.code is ErrorCode.PROVIDER_UNAVAILABLE


def test_busy_provider_is_recoverable():
    error = errors.ClientError(429, {"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}})
    with pytest.raises(AIError) as excinfo:
        _check(error)[0].check(JPEG, "image/jpeg")
    assert excinfo.value.recoverable is True
