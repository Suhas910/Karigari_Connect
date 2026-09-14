"""
Submission, claim review, approval and ONDC export.

Built on the legacy paths (no network, no model), with the artisan replacing the demo
catalogue by taxonomy values on confirm, which is what the Confirm screen asks for.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.ai.linkage import export as export_module
from app.main import app

client = TestClient(app)

GOOD_CATALOGUE = {
    "category": "wood_carving",
    "materials": ["teak"],
    "techniques": ["turned", "lacquered"],
    "finish": "natural_dye",
    "title": {"en": "Turned teak toy with natural lacquer", "local": None, "local_language": "kn"},
    "description": {"en": "A teak toy turned on a lathe and finished with natural lacquer.", "local": None},
    "labour": {"hours": 6.0, "skill_level": "skilled", "state_code": "KA"},
    "material_cost_paise": 45000,
}


def _user(role):
    uid = uuid.uuid4().hex[:8]
    res = client.post("/api/v1/auth/register", json={
        "username": f"{role}_{uid}",
        "email": f"{role}_{uid}@karigari.local",
        "password": "ReviewTest123!",
        "role": role,
    })
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _post(path, headers, body=None):
    return client.post(f"/api/v1{path}", json=body if body is not None else {}, headers=headers)


def _drafted(artisan):
    """A listing with a photo, a demo transcript, a demo catalogue and a price."""
    listing_id = _post("/listings", artisan, {"preferred_language": "kn"}).json()["id"]
    for kind, url in (("image", "https://example.invalid/photo.jpg"), ("audio", "https://example.invalid/note.m4a")):
        assert _post(f"/listings/{listing_id}/media", artisan, {"kind": kind, "url": url}).status_code == 200
    audio_id = [m for m in client.get(f"/api/v1/listings/{listing_id}", headers=artisan).json()["media"] if m["kind"] == "audio"][0]["id"]
    assert _post(f"/listings/{listing_id}/jobs/transcription", artisan, {"audio_media_id": audio_id, "declared_language": "kn"}).status_code == 200
    catalogue = _post(f"/listings/{listing_id}/jobs/catalogue", artisan).json()
    price = _post(f"/listings/{listing_id}/price", artisan, {
        "material_cost_paise": 45000, "labour_hours": 6, "skill_level": "skilled", "state_code": "KA",
    })
    assert price.status_code == 200, price.text
    return listing_id, catalogue


def _confirmed(artisan, *, catalogue_changes=None, assert_claim=True):
    listing_id, generated = _drafted(artisan)
    claims = [{"claim": "natural_dye", "asserted_by_artisan": assert_claim, "coordinator_verified": False, "evidence_note": None}]
    body = {
        "catalogue": {
            **generated["catalogue"], **GOOD_CATALOGUE, **(catalogue_changes or {}),
            "provenance": {"claims": claims, "gi_tag": None},
        },
        "confirmed_fields": generated["needs_confirmation"] + ["provenance.natural_dye"],
        "corrections": [],
    }
    assert _post(f"/listings/{listing_id}/confirm", artisan, body).status_code == 200
    return listing_id


def _verify(coordinator, listing_id, claim="natural_dye", note="Checked the dye batch record."):
    return _post(f"/listings/{listing_id}/claims/{claim}/review", coordinator, {"decision": "verified", "evidence_note": note})


def _approved():
    artisan, coordinator = _user("artisan"), _user("coordinator")
    listing_id = _confirmed(artisan)
    assert _verify(coordinator, listing_id).status_code == 200
    res = _post(f"/listings/{listing_id}/approval", coordinator, {"decision": "approve"})
    assert res.status_code == 200, res.text
    return artisan, coordinator, listing_id


# --- submission ----------------------------------------------------------------------

def test_submission_needs_confirmed_details_and_a_photo():
    artisan = _user("artisan")
    listing_id, _ = _drafted(artisan)  # the demo catalogue still has fields to confirm
    res = _post(f"/listings/{listing_id}/submit-for-approval", artisan)
    assert res.status_code == 409
    assert "Still to confirm" in res.json()["error"]["message"]

    empty = _post("/listings", artisan, {"preferred_language": "kn"}).json()["id"]
    message = _post(f"/listings/{empty}/submit-for-approval", artisan).json()["error"]["message"]
    assert "no product details" in message and "no photo" in message


def test_readiness_reports_the_same_problems_the_endpoints_enforce():
    artisan = _user("artisan")
    listing_id = _confirmed(artisan)
    readiness = client.get(f"/api/v1/listings/{listing_id}/readiness", headers=artisan).json()
    assert readiness["submit"] == []
    assert readiness["approve"] == ["Claims not yet reviewed: natural_dye."]


# --- claim review --------------------------------------------------------------------

def test_a_review_cannot_create_a_claim():
    artisan, coordinator = _user("artisan"), _user("coordinator")
    listing_id = _confirmed(artisan)
    res = _verify(coordinator, listing_id, claim="gi_tag")
    assert res.status_code == 404
    assert all(c["claim"] != "gi_tag" for c in client.get(f"/api/v1/listings/{listing_id}", headers=artisan).json()["claims"])


def test_verifying_needs_the_artisans_assertion_and_evidence():
    artisan, coordinator = _user("artisan"), _user("coordinator")
    unasserted = _confirmed(artisan, assert_claim=False)
    assert _verify(coordinator, unasserted).status_code == 409

    asserted = _confirmed(artisan)
    assert _verify(coordinator, asserted, note="  ").status_code == 422
    assert _verify(coordinator, asserted).json()["coordinator_verified"] is True


def test_rejecting_a_claim_needs_a_reason_and_removes_it():
    artisan, coordinator = _user("artisan"), _user("coordinator")
    listing_id = _confirmed(artisan)
    path = f"/listings/{listing_id}/claims/natural_dye/review"
    assert _post(path, coordinator, {"decision": "rejected"}).status_code == 422

    res = _post(path, coordinator, {"decision": "rejected", "reason": "No dye record."})
    assert res.status_code == 200 and res.json()["removed"] is True
    assert client.get(f"/api/v1/listings/{listing_id}", headers=artisan).json()["claims"] == []


def test_artisans_cannot_review_claims():
    artisan = _user("artisan")
    listing_id = _confirmed(artisan)
    assert _verify(artisan, listing_id).status_code == 403


# --- approval ------------------------------------------------------------------------

def test_approval_needs_a_listing_awaiting_approval():
    artisan, coordinator = _user("artisan"), _user("coordinator")
    listing_id, _ = _drafted(artisan)
    res = _post(f"/listings/{listing_id}/approval", coordinator, {"decision": "approve"})
    assert res.status_code == 409


def test_approval_is_refused_while_a_claim_is_unreviewed():
    artisan, coordinator = _user("artisan"), _user("coordinator")
    listing_id = _confirmed(artisan)
    res = _post(f"/listings/{listing_id}/approval", coordinator, {"decision": "approve"})
    assert res.status_code == 409
    assert "natural_dye" in res.json()["error"]["message"]


def test_approval_is_refused_for_details_outside_the_taxonomy():
    artisan, coordinator = _user("artisan"), _user("coordinator")
    listing_id = _confirmed(artisan, catalogue_changes={"materials": ["Ivory Wood (Aale Mara)"]})
    assert _verify(coordinator, listing_id).status_code == 200
    res = _post(f"/listings/{listing_id}/approval", coordinator, {"decision": "approve"})
    assert res.status_code == 409
    assert "Details: materials" in res.json()["error"]["message"]


def test_rejecting_a_listing_needs_a_reason():
    artisan, coordinator = _user("artisan"), _user("coordinator")
    listing_id = _confirmed(artisan)
    assert _post(f"/listings/{listing_id}/approval", coordinator, {"decision": "reject"}).status_code == 422
    res = _post(f"/listings/{listing_id}/approval", coordinator, {"decision": "reject", "reason": "The photo shows a different piece."})
    assert res.json()["status"] == "rejected"


# --- export --------------------------------------------------------------------------

def test_an_approved_listing_exports_a_validated_ondc_payload():
    _, coordinator, listing_id = _approved()
    res = _post(f"/listings/{listing_id}/exports", coordinator, {"target": "ondc"})
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["status"] == "validated"
    assert body["network_submission"] == "not_attempted"
    assert body["contract_validation"]["passed"] is True
    assert "ONDC-Official/ONDC-RET-Specifications" in body["contract_validation"]["schema_source"]

    payload = body["payload"]
    assert payload["context"]["bpp_id"].endswith(".invalid")
    assert "gov.in" not in str(payload)
    item = payload["message"]["catalog"]["bpp/providers"][0]["items"][0]
    tags = {t["code"]: t["value"] for t in item["tags"]["list"]}
    assert tags["verified_claims"] == "natural_dye"
    assert tags["wage_floor_source"].startswith("DEMO-FIXTURE")
    assert item["descriptor"]["images"] == []
    assert any("No images" in w for w in body["warnings"])
    assert any("demonstration rate" in w for w in body["warnings"])


def test_a_simulated_submission_is_labelled_and_does_not_mark_the_listing_exported():
    artisan, coordinator, listing_id = _approved()
    body = _post(f"/listings/{listing_id}/exports", coordinator, {"target": "ondc", "simulate_network_submission": True}).json()
    assert body["network_submission"] == "simulated"
    assert client.get(f"/api/v1/listings/{listing_id}", headers=artisan).json()["state"] == "approved"


def test_artisans_cannot_export():
    artisan, _, listing_id = _approved()
    assert _post(f"/listings/{listing_id}/exports", artisan, {"target": "ondc"}).status_code == 403


def test_an_unapproved_listing_cannot_be_exported():
    artisan, coordinator = _user("artisan"), _user("coordinator")
    listing_id = _confirmed(artisan)
    res = _post(f"/listings/{listing_id}/exports", coordinator, {"target": "ondc"})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "LISTING_STATE_INVALID"


def test_a_schema_violation_fails_the_export_and_is_recorded(monkeypatch):
    _, coordinator, listing_id = _approved()
    monkeypatch.setattr(export_module.contract_test, "validate", lambda payload: ["message/catalog: broken"])
    res = _post(f"/listings/{listing_id}/exports", coordinator, {"target": "ondc"})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "EXPORT_CONTRACT_INVALID"


@pytest.mark.parametrize("target", ["gem", "tribes_india"])
def test_unbuilt_targets_are_refused(target):
    _, coordinator, listing_id = _approved()
    assert _post(f"/listings/{listing_id}/exports", coordinator, {"target": target}).status_code == 422
