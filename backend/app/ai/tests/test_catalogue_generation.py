"""
Catalogue generation: the generation schema, the draft check, and the Gemini adapter
against a fake client. The live test is opt-in.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from google.genai import errors

from app.ai import gemini_client
from app.ai.adapters import GeminiCatalogueAdapter
from app.ai.contracts import AdapterInfo, AIError, ErrorCode, TranscriptResult
from app.ai.taxonomy.generation import draft_schema, publish_schema, response_schema, validate_draft

SAID = "This is a handwoven silk saree with an extra-weft border. It took me sixty hours on a pit loom."


def _transcript(text=SAID):
    return TranscriptResult(
        transcript_id="job-1",
        detected_language="en",
        original_text=text,
        overall_confidence=None,
        adapter=AdapterInfo(provider="gemini", model="gemini-3.5-flash"),
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
    def __init__(self, outcome):
        self.outcome = outcome
        self.calls = []

    def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def _adapter(outcome, taxonomy):
    models = _Models(outcome)
    adapter = GeminiCatalogueAdapter(client=SimpleNamespace(models=models), model="gemini-3.5-flash", taxonomy=taxonomy)
    return adapter, models


def _valid_draft(**changes):
    draft = {
        "listing_id": "L-1",
        "category": "handloom_saree",
        "materials": ["silk"],
        "techniques": ["handloom_weave"],
        "title": {"en": "Handwoven silk saree"},
        "description": {"en": "A silk saree woven by hand on a pit loom."},
        "labour": {"hours": None, "skill_level": None, "state_code": None},
        "material_cost_inr": None,
        "provenance": {"claims": [], "gi_tag": None},
        "source": {"transcript_id": "job-1", "asr_confidence": None},
    }
    draft.update(changes)
    return draft


# --- generation schema ---------------------------------------------------------------

def test_each_category_offers_only_its_own_materials_and_techniques(taxonomy):
    branches = response_schema(taxonomy)["anyOf"]
    assert [b["properties"]["category"]["enum"] for b in branches] == [[c["id"]] for c in taxonomy["categories"]]
    for branch, category in zip(branches, taxonomy["categories"]):
        assert branch["properties"]["materials"]["items"]["enum"] == category["materials"]
        assert branch["properties"]["techniques"]["items"]["enum"] == category["techniques"]


def test_the_model_is_given_no_gi_tag_field(taxonomy):
    for branch in response_schema(taxonomy)["anyOf"]:
        assert not any("gi" in name for name in branch["properties"])


def test_every_taxonomy_value_is_allowed_by_the_listing_schema(taxonomy, listing_schema):
    props = listing_schema["properties"]
    for category in taxonomy["categories"]:
        assert category["id"] in props["category"]["enum"]
        assert set(category["materials"]) <= set(props["materials"]["items"]["enum"])
        assert set(category["techniques"]) <= set(props["techniques"]["items"]["enum"])


def test_draft_schema_relaxes_only_the_unstated_facts(listing_schema):
    changed = []

    def walk(a, b, path):
        if a == b:
            return
        if isinstance(a, dict) and isinstance(b, dict):
            for key in set(a) | set(b):
                walk(a.get(key), b.get(key), [*path, key])
        else:
            changed.append(".".join(path))

    walk(listing_schema, draft_schema(), [])
    assert sorted(changed) == sorted([
        "properties.labour.properties.hours.type",
        "properties.labour.properties.skill_level.type",
        "properties.labour.properties.skill_level.enum",
        "properties.labour.properties.state_code.type",
        "properties.material_cost_inr.type",
        "properties.source.properties.asr_confidence.type",
    ])


def test_publish_schema_relaxes_only_speech_confidence(listing_schema):
    published = publish_schema()
    assert published["properties"]["source"]["properties"]["asr_confidence"]["type"] == ["number", "null"]
    published["properties"]["source"]["properties"]["asr_confidence"] = listing_schema["properties"]["source"]["properties"]["asr_confidence"]
    assert published == listing_schema


# --- draft validation ----------------------------------------------------------------

def test_a_draft_with_unstated_facts_is_valid(taxonomy):
    validate_draft(_valid_draft(), taxonomy)


@pytest.mark.parametrize(
    "changes",
    [
        {"techniques": ["hand_woven"]},  # a basket technique on a saree
        {"materials": ["bamboo"]},
        {"materials": ["ivory_wood"]},  # not in the taxonomy at all
        {"category": "wooden_toy"},
        {"labour": {"hours": 6, "skill_level": None, "state_code": "Karnataka"}},
        {"title": {"en": "Saree", "subtitle": "extra field"}},
    ],
)
def test_invalid_drafts_are_refused(taxonomy, changes):
    with pytest.raises(AIError) as excinfo:
        validate_draft(_valid_draft(**changes), taxonomy)
    assert excinfo.value.code is ErrorCode.CATALOGUE_SCHEMA_INVALID


# --- adapter -------------------------------------------------------------------------

def test_sends_the_transcript_with_the_generation_schema(taxonomy):
    adapter, models = _adapter(_reply(), taxonomy)
    adapter.generate(transcript=_transcript(), confirmed_facts={}, listing_id="L-1")

    call = models.calls[0]
    assert SAID in call["contents"]
    assert "null" in call["contents"] and "Do not estimate" in call["contents"]
    assert call["config"].response_json_schema == response_schema(taxonomy)
    assert call["config"].temperature == 0


def test_result_invents_no_facts_confidence_or_gi_tag(taxonomy):
    adapter, _ = _adapter(_reply(), taxonomy)
    result = adapter.generate(transcript=_transcript(), confirmed_facts={}, listing_id="L-1")
    cat = result.catalogue

    assert cat["labour"] == {"hours": 60, "skill_level": None, "state_code": None}
    assert cat["material_cost_inr"] is None
    assert cat["provenance"]["gi_tag"] is None
    assert [c["claim"] for c in cat["provenance"]["claims"]] == ["handloom_weave"]
    assert all(c["asserted_by_artisan"] is False for c in cat["provenance"]["claims"])
    assert cat["source"]["asr_confidence"] is None
    assert cat["source"]["asr_provider"] == "gemini"
    assert result.field_confidence == {}
    assert result.needs_confirmation == [
        "category", "materials", "techniques", "title.en", "description.en",
        "labour.hours", "labour.skill_level", "labour.state_code", "material_cost_paise",
    ]
    assert result.adapter.provider == "gemini"
    validate_draft(cat, taxonomy)


def test_artisan_facts_override_and_need_no_confirmation(taxonomy):
    adapter, _ = _adapter(_reply(labour_hours=40, material_cost_inr=900), taxonomy)
    facts = {"labour_hours": 60, "material_cost_paise": 45000, "state_code": "ka", "skill_level": "skilled"}
    result = adapter.generate(transcript=_transcript(), confirmed_facts=facts, listing_id="L-1")

    assert result.catalogue["labour"] == {"hours": 60, "skill_level": "skilled", "state_code": "KA"}
    assert result.catalogue["material_cost_inr"] == 450
    assert result.needs_confirmation == ["category", "materials", "techniques", "title.en", "description.en"]


def test_output_outside_the_category_is_refused_not_repaired(taxonomy):
    adapter, _ = _adapter(_reply(techniques=["hand_woven"]), taxonomy)
    with pytest.raises(AIError) as excinfo:
        adapter.generate(transcript=_transcript(), confirmed_facts={}, listing_id="L-1")
    assert excinfo.value.code is ErrorCode.CATALOGUE_SCHEMA_INVALID


def test_an_invalid_artisan_fact_is_refused(taxonomy):
    adapter, _ = _adapter(_reply(), taxonomy)
    with pytest.raises(AIError) as excinfo:
        adapter.generate(transcript=_transcript(), confirmed_facts={"labour_hours": -3}, listing_id="L-1")
    assert excinfo.value.code is ErrorCode.CATALOGUE_SCHEMA_INVALID


@pytest.mark.parametrize("text", ["not json", None, json.dumps({"category": "handloom_saree"})])
def test_unreadable_response_is_a_provider_error(taxonomy, text):
    adapter, _ = _adapter(SimpleNamespace(text=text, model_version=None), taxonomy)
    with pytest.raises(AIError) as excinfo:
        adapter.generate(transcript=_transcript(), confirmed_facts={}, listing_id="L-1")
    assert excinfo.value.code is ErrorCode.PROVIDER_UNAVAILABLE


def test_empty_transcript_is_refused_before_any_call(taxonomy):
    adapter, models = _adapter(_reply(), taxonomy)
    with pytest.raises(AIError) as excinfo:
        adapter.generate(transcript=_transcript(text="  "), confirmed_facts={}, listing_id="L-1")
    assert excinfo.value.code is ErrorCode.LISTING_STATE_INVALID
    assert models.calls == []


def test_a_different_taxonomy_version_is_refused(taxonomy):
    adapter, models = _adapter(_reply(), taxonomy)
    with pytest.raises(AIError) as excinfo:
        adapter.generate(transcript=_transcript(), confirmed_facts={}, taxonomy_version="9.9.9", listing_id="L-1")
    assert excinfo.value.code is ErrorCode.CATALOGUE_SCHEMA_INVALID
    assert models.calls == []


def test_busy_provider_is_recoverable(taxonomy):
    error = errors.ServerError(503, {"error": {"code": 503, "message": "busy", "status": "UNAVAILABLE"}})
    adapter, _ = _adapter(error, taxonomy)
    with pytest.raises(AIError) as excinfo:
        adapter.generate(transcript=_transcript(), confirmed_facts={}, listing_id="L-1")
    assert excinfo.value.code is ErrorCode.PROVIDER_UNAVAILABLE
    assert excinfo.value.recoverable is True


# --- legacy --------------------------------------------------------------------------

def test_legacy_client_names_no_gi_registration():
    assert "GI-" not in Path(gemini_client.__file__).read_text(encoding="utf-8")


@pytest.mark.parametrize("language", ["hi", "kn", "en"])
def test_legacy_fallback_carries_no_gi_tag(language):
    legacy = gemini_client.GeminiClient.__new__(gemini_client.GeminiClient)
    legacy.client = None
    result = legacy.extract_catalogue_metadata("anything", declared_language=language)
    assert result["gi_tag"] is None
    assert all(c["claim"] != "gi_tag" for c in result["claims"])


# --- live, opt-in --------------------------------------------------------------------

@pytest.mark.skipif(os.getenv("CRAFTLINK_LIVE_GEMINI") != "1", reason="set CRAFTLINK_LIVE_GEMINI=1 to call Gemini")
def test_live_generation_keeps_unstated_facts_null(taxonomy):
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[3] / ".env")
    result = GeminiCatalogueAdapter(taxonomy=taxonomy).generate(
        transcript=_transcript(), confirmed_facts={}, listing_id="L-live"
    )
    cat = result.catalogue
    assert cat["category"] == "handloom_saree"
    assert cat["labour"]["hours"] == 60
    assert cat["material_cost_inr"] is None
    assert cat["provenance"]["gi_tag"] is None
