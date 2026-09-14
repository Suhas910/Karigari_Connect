"""
From a stored listing to a validated ONDC on_search payload, and the readiness checks
that gate submission, approval and export.

Replaces a hand-built dict in `routers/coordinator.py` that:

- reported `contract_validation.passed: true` without validating anything;
- named `karigari.mosje.gov.in`, a government domain nobody registered, as the seller app;
- put login-only media links and legacy stock-photo URLs in `images`;
- tagged every item `statutory_wage_protected: true`, priced or not;
- let any signed-in user, artisans included, export a listing nobody had approved, and
  marked it `exported` although nothing was sent.

Here the payload comes from `beckn.build_on_search`, the builder the contract test covers,
and is validated against the committed ONDC schema on every export. Nothing is sent to a
network, so the listing is never marked exported. Images are the public copies approval
makes (`app/public_media.py`), never the private upload links.

Left out on purpose, and reported as warnings:

- The GI tag. The GI registry ships empty, so no tag can be checked.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any

from ..contracts import ErrorCode
from ..taxonomy.generation import listing_problems
from ..taxonomy.guard import ProvenanceViolation, enforce, load_taxonomy
from . import contract_test
from .beckn import build_on_search

# `.invalid` is reserved (RFC 2606) and never resolves, so a staged payload that validates
# can never be delivered by mistake. Real identities come from ONDC registration and from
# the incoming /search.
STAGING_BAP_ID = "buyer.staging.invalid"
STAGING_BAP_URI = "https://buyer.staging.invalid/ondc"
STAGING_BPP_ID = "craftlink.staging.invalid"


class ExportRefused(Exception):
    def __init__(self, code: ErrorCode, problems: list[str]):
        super().__init__("; ".join(problems))
        self.code = code
        self.problems = problems


@dataclass
class ExportBuild:
    payload: dict[str, Any]
    violations: list[str]
    schema_source: str
    warnings: list[str] = field(default_factory=list)


def _inr(paise: int) -> float | int:
    value = paise / 100
    return int(value) if float(value).is_integer() else round(value, 2)


def _has_photo(listing: Any) -> bool:
    return any(m.kind == "image" and m.variant == "original" for m in listing.media)


def _needs_confirmation(listing: Any) -> list[str]:
    if listing.catalogue is None:
        return []
    return list(json.loads(listing.catalogue.needs_confirmation or "[]"))


def listing_document(listing: Any) -> dict[str, Any]:
    """The stored listing in `listing.schema.json` shape.

    Claims come from the claim records, which hold the artisan's and coordinator's
    decisions, not from the catalogue copy the artisan last edited.
    """
    cat = json.loads(listing.catalogue.catalogue_data) if listing.catalogue else {}

    title_src = cat.get("title") or {}
    title = {"en": title_src.get("en") or ""}
    if title_src.get("local"):
        title["local"] = title_src["local"]
        if title_src.get("local_language"):
            title["local_language"] = title_src["local_language"]
    description_src = cat.get("description") or {}
    description = {"en": description_src.get("en") or ""}
    if description_src.get("local"):
        description["local"] = description_src["local"]

    labour_src = cat.get("labour") or {}
    source_src = cat.get("source") or {}
    source: dict[str, Any] = {
        "transcript_id": source_src.get("transcript_id") or "",
        "asr_confidence": source_src.get("asr_confidence"),
        "image_ids": [],
    }
    if source_src.get("asr_provider"):
        source["asr_provider"] = source_src["asr_provider"]

    claims = []
    for claim in live_claims(listing):
        entry: dict[str, Any] = {
            "claim": claim.claim,
            "asserted_by_artisan": bool(claim.asserted_by_artisan),
            "coordinator_verified": bool(claim.coordinator_verified),
        }
        if claim.evidence_note:
            entry["evidence_note"] = claim.evidence_note[:300]
        claims.append(entry)

    document: dict[str, Any] = {
        "listing_id": listing.id,
        "category": cat.get("category") or "",
        "materials": list(cat.get("materials") or []),
        "techniques": list(cat.get("techniques") or []),
        "title": title,
        "description": description,
        "labour": {key: labour_src.get(key) for key in ("hours", "skill_level", "state_code")},
        "provenance": {"claims": claims, "gi_tag": None},
        "source": source,
    }
    if cat.get("finish"):
        document["finish"] = cat["finish"]
    if cat.get("material_cost_paise") is not None:
        document["material_cost_inr"] = _inr(cat["material_cost_paise"])
    return document


def live_claims(listing: Any) -> list[Any]:
    """Claims a coordinator has not rejected. Rejected rows are kept only as a record."""
    return [c for c in listing.claims if getattr(c, "rejected_at", None) is None]


def submission_problems(listing: Any) -> list[str]:
    """What stops an artisan submitting for review. Empty means ready."""
    problems = []
    if listing.catalogue is None:
        problems.append("There are no product details yet.")
    elif _needs_confirmation(listing):
        problems.append("Still to confirm: " + ", ".join(_needs_confirmation(listing)) + ".")
    if not _has_photo(listing):
        problems.append("There is no photo.")
    return problems


def approval_problems(listing: Any, taxonomy: dict | None = None) -> list[str]:
    """What stops a coordinator approving. Empty means ready."""
    taxonomy = taxonomy or load_taxonomy()
    problems = submission_problems(listing)
    if listing.price is None or listing.price.status != "available":
        problems.append("There is no price with a wage floor.")
    pending = sorted(c.claim for c in live_claims(listing) if c.asserted_by_artisan and not c.coordinator_verified)
    if pending:
        problems.append("Claims not yet reviewed: " + ", ".join(pending) + ".")
    if listing.catalogue is not None:
        document = listing_document(listing)
        problems += [f"Details: {problem}" for problem in listing_problems(document, taxonomy, draft=False)]
        try:
            enforce(document, taxonomy)
        except ProvenanceViolation as exc:
            problems.append(f"Provenance: {exc}.")
    return problems


def build_export(listing: Any, taxonomy: dict | None = None) -> ExportBuild:
    """The ONDC payload for an approved listing, validated, or ExportRefused."""
    taxonomy = taxonomy or load_taxonomy()
    if listing.state not in ("approved", "exported"):
        raise ExportRefused(
            ErrorCode.LISTING_STATE_INVALID,
            [f"The listing is {listing.state}; only an approved listing can be exported."],
        )
    problems = approval_problems(listing, taxonomy)
    if problems:
        raise ExportRefused(ErrorCode.EXPORT_CONTRACT_INVALID, problems)

    document = listing_document(listing)
    published = enforce(document, taxonomy)  # strips anything unverified; checked above not to empty it
    price = listing.price
    band = {
        "floor": _inr(price.floor_amount_paise),
        "fair": _inr(price.recommended_low_paise),
        "currency": price.currency or "INR",
        "wage_source_ref": price.notification_ref or "unrecorded",
    }

    bpp_id = os.getenv("CRAFTLINK_ONDC_BPP_ID") or STAGING_BPP_ID
    bpp_uri = os.getenv("CRAFTLINK_ONDC_BPP_URI") or f"https://{bpp_id}/ondc"
    provider_name = os.getenv("CRAFTLINK_ONDC_PROVIDER_NAME") or "CraftLink artisan cluster (staging)"
    payload = build_on_search(
        listings_with_prices=[(published, band)],
        provider_id=f"artisan-{listing.artisan_id}",
        provider_name=provider_name,
        bap_id=STAGING_BAP_ID,
        bap_uri=STAGING_BAP_URI,
        bpp_id=bpp_id,
        bpp_uri=bpp_uri,
    )
    image_urls = [photo.url for photo in listing.public_photos]
    for provider in payload["message"]["catalog"]["bpp/providers"]:
        for item in provider["items"]:
            item["descriptor"]["images"] = list(image_urls)
    violations = contract_test.validate(payload)

    warnings = []
    if not image_urls:
        warnings.append("No images are included: this listing has no uploaded photo file to copy for buyers.")
    elif any(not url.startswith("https://") for url in image_urls):
        warnings.append("Photo links point at a development server, so buyers outside this network cannot open them.")
    if (price.source_url or "").startswith("unsourced://"):
        warnings.append(
            f"The wage floor uses a demonstration rate ({price.notification_ref}), not a government notification."
        )
    left_out = sorted(set(document["techniques"]) - set(published["techniques"]))
    if left_out:
        warnings.append("Left out because not verified: " + ", ".join(left_out) + ".")
    if bpp_id == STAGING_BPP_ID:
        warnings.append(
            "Seller and buyer app identities are staging placeholders; set CRAFTLINK_ONDC_BPP_ID after ONDC registration."
        )

    provenance = json.loads(contract_test.SCHEMA_PATH.read_text(encoding="utf-8")).get("x-craftlink-provenance", {})
    schema_source = (
        f"{provenance.get('source_repo')}@{provenance.get('source_commit')} "
        f"(core {provenance.get('core_version')})"
    )
    return ExportBuild(payload=payload, violations=violations, schema_source=schema_source, warnings=warnings)


__all__ = [
    "ExportBuild",
    "ExportRefused",
    "STAGING_BAP_ID",
    "STAGING_BPP_ID",
    "approval_problems",
    "build_export",
    "listing_document",
    "submission_problems",
]
