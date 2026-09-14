"""
Catalogue generation with CRAFTLINK_CATALOGUE=gemini, from upload to price.

Gemini is a fake client inside the real GeminiCatalogueAdapter, so the generation
schema, draft validation, provenance gate and storage all run for real. Speech is a
fake adapter; app/ai/tests covers both adapters on their own.
"""

import io
import json
import uuid
import wave
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.ai import service as ai_service_module
from app.ai.adapters import GeminiCatalogueAdapter, registry
from app.ai.contracts import AdapterInfo, TranscriptResult
from app.main import app

client = TestClient(app)

SAID = "This is a handwoven silk saree with an extra-weft border. It took me sixty hours on a pit loom."


class _Speech:
    name = "gemini"

    def is_available(self):
        return True

    def transcribe(self, audio, *, declared_language=None, transcript_id=None):
        return TranscriptResult(
            transcript_id=transcript_id,
            detected_language="en",
            original_text=SAID,
            overall_confidence=None,
            adapter=AdapterInfo(provider="gemini", model="gemini-3.5-flash", on_device=False),
        )


def _reply(**changes):
    body = {
        "category": "handloom_saree",
        "materials": ["silk"],
        "techniques": ["handloom_weave", "extra_weft"],
        "finish": None,
        "title_en": "Handwoven silk saree with extra-weft border",
        "title_local": None,
        "description_en": "A silk saree woven by hand on a pit loom, with an extra-weft border.",
        "description_local": None,
        "labour_hours": 60,
        "material_cost_inr": None,
        "claims_stated": ["handloom_weave"],
    }
    body.update(changes)
    return SimpleNamespace(text=json.dumps(body), model_version="gemini-3.5-flash")


class _Models:
    def __init__(self):
        self.reply = _reply()
        self.prompts = []

    def generate_content(self, *, model, contents, config):
        self.prompts.append(contents)
        return self.reply


@pytest.fixture
def gemini(monkeypatch):
    monkeypatch.setenv("CRAFTLINK_ASR", "gemini")
    monkeypatch.setenv("CRAFTLINK_CATALOGUE", "gemini")
    monkeypatch.setitem(registry._ASR, "gemini", lambda: _Speech())
    models = _Models()
    monkeypatch.setattr(
        ai_service_module,
        "GeminiCatalogueAdapter",
        lambda: GeminiCatalogueAdapter(client=SimpleNamespace(models=models)),
    )
    return models


def _artisan():
    uid = uuid.uuid4().hex[:8]
    res = client.post("/api/v1/auth/register", json={
        "username": f"artisan_{uid}",
        "email": f"artisan_{uid}@karigari.local",
        "password": "CatalogueTest123!",
        "role": "artisan",
    })
    assert res.status_code == 200, res.text
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    listing = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=headers)
    assert listing.status_code == 200, listing.text
    return headers, listing.json()["id"]


def _wav():
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(bytes(range(256)) * 20)
    return buf.getvalue()


def _transcribed():
    headers, listing_id = _artisan()
    upload = client.post(
        f"/api/v1/listings/{listing_id}/media/upload",
        data={"kind": "audio"},
        files={"file": ("note.wav", _wav(), "audio/wav")},
        headers=headers,
    )
    assert upload.status_code == 200, upload.text
    job = client.post(
        f"/api/v1/listings/{listing_id}/jobs/transcription",
        json={"audio_media_id": upload.json()["media_id"], "declared_language": "en"},
        headers=headers,
    )
    assert job.status_code == 200, job.text
    return headers, listing_id, job.json()["job_id"]


def _generate(listing_id, headers, body=None):
    return client.post(f"/api/v1/listings/{listing_id}/jobs/catalogue", json=body or {}, headers=headers)


def test_catalogue_comes_from_the_transcript_and_invents_nothing(gemini):
    headers, listing_id, job_id = _transcribed()

    res = _generate(listing_id, headers, {"confirmed_facts": {"state_code": "KA"}})
    assert res.status_code == 200, res.text
    body = res.json()
    cat = body["catalogue"]

    assert SAID in gemini.prompts[0]
    assert cat["category"] == "handloom_saree"
    assert cat["labour"] == {"hours": 60.0, "skill_level": None, "state_code": "KA"}
    assert cat["material_cost_paise"] is None
    assert cat["provenance"]["gi_tag"] is None
    assert cat["source"] == {"transcript_id": job_id, "asr_confidence": None}
    # handloom_weave is sensitive and unverified, so the provenance gate removes it.
    assert cat["techniques"] == ["extra_weft"]
    assert body["field_confidence"] == {}
    assert {"labour.hours", "labour.skill_level", "material_cost_paise", "provenance.handloom_weave"} <= set(
        body["needs_confirmation"]
    )
    assert "labour.state_code" not in body["needs_confirmation"]

    listing = client.get(f"/api/v1/listings/{listing_id}", headers=headers).json()
    assert listing["catalogue"] is not None
    assert listing["state"] == "awaiting_confirmation"


def test_no_transcript_means_no_catalogue(gemini):
    headers, listing_id = _artisan()
    res = _generate(listing_id, headers)
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "LISTING_STATE_INVALID"
    assert gemini.prompts == []


def test_invalid_generation_is_refused_and_nothing_is_stored(gemini):
    gemini.reply = _reply(techniques=["hand_woven"])
    headers, listing_id, _ = _transcribed()

    res = _generate(listing_id, headers)
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "CATALOGUE_SCHEMA_INVALID"
    assert client.get(f"/api/v1/listings/{listing_id}", headers=headers).json()["catalogue"] is None


def test_price_refuses_until_the_material_cost_is_known(gemini):
    headers, listing_id, _ = _transcribed()
    assert _generate(listing_id, headers).status_code == 200

    res = client.post(
        f"/api/v1/listings/{listing_id}/price",
        json={"skill_level": "skilled", "state_code": "KA"},
        headers=headers,
    )
    assert res.status_code == 422, res.text
    assert res.json()["error"]["code"] == "CATALOGUE_SCHEMA_INVALID"


def _confirm(listing_id, headers, catalogue, confirmed_fields):
    return client.post(
        f"/api/v1/listings/{listing_id}/confirm",
        json={"catalogue": catalogue, "confirmed_fields": confirmed_fields, "corrections": []},
        headers=headers,
    )


def test_price_uses_the_confirmed_catalogue_not_defaults(gemini):
    headers, listing_id, _ = _transcribed()
    cat = _generate(listing_id, headers).json()["catalogue"]
    confirmed = {
        **cat,
        "labour": {"hours": 12, "skill_level": "semi_skilled", "state_code": "KA"},
        "material_cost_paise": 30000,
    }
    res = _confirm(listing_id, headers, confirmed, ["labour.hours", "labour.skill_level", "labour.state_code", "material_cost_paise"])
    assert res.status_code == 200, res.text

    price = client.post(f"/api/v1/listings/{listing_id}/price", json={}, headers=headers)
    assert price.status_code == 200, price.text
    inputs = price.json()["inputs"]
    assert inputs["material_cost_paise"] == 30000
    assert inputs["labour_hours"] == 12
    assert inputs["skill_level"] == "semi_skilled"
    assert price.json()["wage_source"]["state_code"] == "KA"


def test_price_with_no_catalogue_and_no_inputs_is_refused(gemini):
    headers, listing_id = _artisan()
    res = client.post(f"/api/v1/listings/{listing_id}/price", json={}, headers=headers)
    assert res.status_code == 422, res.text
    assert res.json()["error"]["code"] == "CATALOGUE_SCHEMA_INVALID"


def test_artisan_yes_on_a_claim_records_the_assertion(gemini):
    headers, listing_id, _ = _transcribed()
    cat = _generate(listing_id, headers).json()["catalogue"]
    claims = [{**c, "asserted_by_artisan": True} for c in cat["provenance"]["claims"]]

    res = _confirm(listing_id, headers, {**cat, "provenance": {**cat["provenance"], "claims": claims}}, ["provenance.handloom_weave"])
    assert res.status_code == 200, res.text

    rows = [c for c in client.get(f"/api/v1/listings/{listing_id}", headers=headers).json()["claims"] if c["claim"] == "handloom_weave"]
    assert len(rows) == 1
    assert rows[0]["asserted_by_artisan"] is True
    assert rows[0]["coordinator_verified"] is False


def test_artisan_no_on_a_claim_removes_it(gemini):
    headers, listing_id, _ = _transcribed()
    cat = _generate(listing_id, headers).json()["catalogue"]

    res = _confirm(listing_id, headers, {**cat, "provenance": {**cat["provenance"], "claims": []}}, ["provenance.handloom_weave"])
    assert res.status_code == 200, res.text

    claims = client.get(f"/api/v1/listings/{listing_id}", headers=headers).json()["claims"]
    assert all(c["claim"] != "handloom_weave" for c in claims)


def test_an_unknown_catalogue_mode_fails_loudly(gemini, monkeypatch):
    headers, listing_id, _ = _transcribed()
    monkeypatch.setenv("CRAFTLINK_CATALOGUE", "gpt")
    res = _generate(listing_id, headers)
    assert res.status_code == 500
    assert "CRAFTLINK_CATALOGUE" in res.json()["error"]["message"]
