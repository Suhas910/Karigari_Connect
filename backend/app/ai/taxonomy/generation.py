"""
The structure Gemini generates a listing into, and the check the result must pass.

`listing.schema.json` is the listing shape. Two things in it do not fit a freshly
generated draft, and this module is where the difference is written down:

1. Facts the artisan did not say. The schema requires labour hours, skill level and
   state. Its own note says hours come from the artisan, not a model, and a model asked
   to fill a required number fills it. So a draft may carry null for `labour.hours`,
   `labour.skill_level`, `labour.state_code` and `material_cost_inr`. The artisan
   supplies them on the confirmation screen, and pricing refuses until they exist.
2. Speech confidence. Gemini reports none (see `adapters/gemini_asr.py`), so
   `source.asr_confidence` may be null.

Nothing else is relaxed. The schema's flat lists also allow a material or technique
from another category; `validate_draft` refuses that, and `response_schema` makes it
unavailable to the model by giving each category its own branch. Checked 2026-09-14:
with flat lists Gemini called a saree "hand_woven", a basket technique; with branches
it chose "handloom_weave".
"""

from __future__ import annotations

import copy
import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

from ..contracts import AIError, ErrorCode

LISTING_SCHEMA_PATH = Path(__file__).resolve().parent / "listing.schema.json"


def _nullable(prop: dict) -> dict:
    prop = dict(prop)
    prop["type"] = [prop["type"], "null"]
    if "enum" in prop:
        prop["enum"] = [*prop["enum"], None]
    return prop


@lru_cache(maxsize=1)
def _draft_schema() -> dict:
    schema = json.loads(LISTING_SCHEMA_PATH.read_text(encoding="utf-8"))
    props = schema["properties"]
    labour = props["labour"]["properties"]
    for key in ("hours", "skill_level", "state_code"):
        labour[key] = _nullable(labour[key])
    props["material_cost_inr"] = _nullable(props["material_cost_inr"])
    source = props["source"]["properties"]
    source["asr_confidence"] = _nullable(source["asr_confidence"])
    return schema


def draft_schema() -> dict:
    return copy.deepcopy(_draft_schema())


@lru_cache(maxsize=1)
def _publish_schema() -> dict:
    """The listing schema for approval and export: every fact required, and only speech
    confidence allowed to be null, because Gemini reports none."""
    schema = json.loads(LISTING_SCHEMA_PATH.read_text(encoding="utf-8"))
    source = schema["properties"]["source"]["properties"]
    source["asr_confidence"] = _nullable(source["asr_confidence"])
    return schema


def publish_schema() -> dict:
    return copy.deepcopy(_publish_schema())


def response_schema(taxonomy: Mapping[str, Any]) -> dict:
    """What Gemini must return. One branch per category.

    There is no GI tag field: the GI registry ships empty, so no value could be checked.
    Unstated facts are nullable so the model has an honest answer available.
    """
    common = {
        "finish": {"type": ["string", "null"], "enum": [*taxonomy["finishes"], None]},
        "title_en": {"type": "string"},
        "title_local": {"type": ["string", "null"]},
        "description_en": {"type": "string"},
        "description_local": {"type": ["string", "null"]},
        "labour_hours": {"type": ["number", "null"]},
        "material_cost_inr": {"type": ["number", "null"]},
        "claims_stated": {
            "type": "array",
            "items": {"type": "string", "enum": taxonomy["claim_verification"]["requires_coordinator_verification"]},
        },
    }
    branches = []
    for category in taxonomy["categories"]:
        properties = {
            "category": {"type": "string", "enum": [category["id"]]},
            "materials": {
                "type": "array", "minItems": 1, "maxItems": 4,
                "items": {"type": "string", "enum": category["materials"]},
            },
            "techniques": {
                "type": "array", "minItems": 1, "maxItems": 4,
                "items": {"type": "string", "enum": category["techniques"]},
            },
            **common,
        }
        branches.append({"type": "object", "properties": properties, "required": list(properties)})
    return {"anyOf": branches}


def listing_problems(listing: Mapping[str, Any], taxonomy: Mapping[str, Any], *, draft: bool) -> list[str]:
    """Every way `listing` breaks the draft (or publish) schema or its category's lists."""
    try:
        from jsonschema import Draft202012Validator
    except ImportError as exc:
        raise AIError(
            ErrorCode.PROVIDER_UNAVAILABLE,
            "Listing validation is not installed (pip install -r requirements-ai.txt).",
            recoverable=False,
        ) from exc

    schema = _draft_schema() if draft else _publish_schema()
    errors = sorted(Draft202012Validator(schema).iter_errors(listing), key=lambda e: list(e.path))
    problems = [f"{'.'.join(str(p) for p in e.path) or 'listing'}: {e.message}" for e in errors]

    category = next((c for c in taxonomy["categories"] if c["id"] == listing.get("category")), None)
    if category:
        for field in ("materials", "techniques"):
            outside = [v for v in listing.get(field) or [] if isinstance(v, str) and v not in category[field]]
            if outside:
                problems.append(f"{field}: {', '.join(outside)} not allowed for {category['id']}")
    return problems


def validate_draft(listing: Mapping[str, Any], taxonomy: Mapping[str, Any]) -> None:
    """Raise CATALOGUE_SCHEMA_INVALID unless `listing` is a valid draft. Never repairs."""
    problems = listing_problems(listing, taxonomy, draft=True)
    if problems:
        raise AIError(
            ErrorCode.CATALOGUE_SCHEMA_INVALID,
            "The generated listing failed validation: " + "; ".join(problems),
            recoverable=True,
            action="retry_later",
        )


__all__ = [
    "LISTING_SCHEMA_PATH",
    "draft_schema",
    "listing_problems",
    "publish_schema",
    "response_schema",
    "validate_draft",
]
