# backend/tests/test_api_flow.py
import uuid
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "karigari-connect-backend"}

def test_full_artisan_and_coordinator_lifecycle():
    uid = uuid.uuid4().hex[:6]
    artisan_username = f"artisan_{uid}"
    artisan_email = f"artisan_{uid}@karigari.local"

    coord_username = f"coordinator_{uid}"
    coord_email = f"coord_{uid}@mosje.gov.in"

    # 1. Register Artisan
    artisan_payload = {
        "username": artisan_username,
        "email": artisan_email,
        "password": "ArtisanPassword123!",
        "role": "artisan"
    }
    res = client.post("/api/v1/auth/register", json=artisan_payload)
    assert res.status_code == 200, res.text
    artisan_token = res.json()["access_token"]
    artisan_headers = {"Authorization": f"Bearer {artisan_token}"}
    assert res.json()["role"] == "artisan"

    # 2. Register Coordinator
    coordinator_payload = {
        "username": coord_username,
        "email": coord_email,
        "password": "CoordinatorPassword123!",
        "role": "coordinator"
    }
    res_coord = client.post("/api/v1/auth/register", json=coordinator_payload)
    assert res_coord.status_code == 200, res_coord.text
    coordinator_token = res_coord.json()["access_token"]
    coord_headers = {"Authorization": f"Bearer {coordinator_token}"}
    assert res_coord.json()["role"] == "coordinator"

    # 3. Check /auth/me for Artisan
    res_me = client.get("/api/v1/auth/me", headers=artisan_headers)
    assert res_me.status_code == 200
    assert res_me.json()["username"] == artisan_username
    assert res_me.json()["role"] == "artisan"

    # 4. Create Listing Draft
    listing_req = {"preferred_language": "kn"}
    res_listing = client.post("/api/v1/listings", json=listing_req, headers=artisan_headers)
    assert res_listing.status_code == 200, res_listing.text
    listing_data = res_listing.json()
    listing_id = listing_data["id"]
    assert listing_data["state"] == "draft"
    assert listing_data["preferred_language"] == "kn"
    assert "upload_instructions" in listing_data

    # 5. Upload Media Assets (Photo + Voice Note)
    media_img_req = {
        "kind": "image",
        "url": "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=800",
        "client_checksum": "sha256:img_channapatna_001"
    }
    res_img = client.post(f"/api/v1/listings/{listing_id}/media", json=media_img_req, headers=artisan_headers)
    assert res_img.status_code == 200
    media_img_id = res_img.json()["media_id"]

    media_audio_req = {
        "kind": "audio",
        "url": "https://actions.google.com/sounds/v1/ambiences/outdoor_market.ogg",
        "client_checksum": "sha256:audio_channapatna_001"
    }
    res_audio = client.post(f"/api/v1/listings/{listing_id}/media", json=media_audio_req, headers=artisan_headers)
    assert res_audio.status_code == 200
    media_audio_id = res_audio.json()["media_id"]

    # 6. AI Image Studio Enhancer & Quality Audit
    studio_req = {
        "media_id": media_img_id,
        "photos": [res_img.json()["url"]]
    }
    res_studio = client.post(f"/api/v1/listings/{listing_id}/jobs/image-studio", json=studio_req, headers=artisan_headers)
    assert res_studio.status_code == 200
    job_id = res_studio.json()["job_id"]

    # Poll Job Status
    res_job_status = client.get(f"/api/v1/jobs/{job_id}", headers=artisan_headers)
    assert res_job_status.status_code == 200
    assert res_job_status.json()["status"] == "complete"
    assert res_job_status.json()["type"] == "image_studio"

    # Get Job Result
    res_job_result = client.get(f"/api/v1/jobs/{job_id}/result", headers=artisan_headers)
    assert res_job_result.status_code == 200
    job_result = res_job_result.json()
    assert "quality" in job_result
    # Legacy image job: fixed demo grades, labelled as such, and no enhancement claimed.
    assert job_result["adapter"]["provider"] == "fixture"
    assert job_result["transformations"] == []
    assert job_result["enhanced_url"] is None

    # 7. AI Multilingual Speech Transcription
    trans_req = {
        "audio_media_id": media_audio_id,
        "declared_language": "kn"
    }
    res_trans = client.post(f"/api/v1/listings/{listing_id}/jobs/transcription", json=trans_req, headers=artisan_headers)
    assert res_trans.status_code == 200
    trans_job_id = res_trans.json()["job_id"]

    res_trans_result = client.get(f"/api/v1/jobs/{trans_job_id}/result", headers=artisan_headers)
    assert res_trans_result.status_code == 200
    assert "transcript" in res_trans_result.json()
    assert "translated_text" in res_trans_result.json()
    assert res_trans_result.json()["asr_confidence"] >= 0.85

    # 8. AI Catalogue Generation
    res_cat = client.post(f"/api/v1/listings/{listing_id}/jobs/catalogue", json={}, headers=artisan_headers)
    assert res_cat.status_code == 200, res_cat.text
    cat_result = res_cat.json()
    assert "catalogue" in cat_result
    assert cat_result["catalogue"]["category"] != ""
    assert len(cat_result["catalogue"]["materials"]) > 0
    assert len(cat_result["catalogue"]["techniques"]) > 0
    assert "field_confidence" in cat_result
    assert isinstance(cat_result["needs_confirmation"], list)

    # 9. Dynamic Pricing Assistant (Statutory Fair Wage Protection)
    price_req = {
        "material_cost_paise": 45000,  # ₹450.00
        "labour_hours": 6.0,
        "skill_level": "skilled",
        "state_code": "KA"
    }
    res_price = client.post(f"/api/v1/listings/{listing_id}/price", json=price_req, headers=artisan_headers)
    assert res_price.status_code == 200, res_price.text
    price_res = res_price.json()
    assert price_res["status"] == "available"
    # The floor is materials plus labour at the wage the response itself reports, rather
    # than at a rate hardcoded here. Two reasons this is the better assertion:
    #
    #  * it states the actual invariant -- floor = materials + hours x hourly wage --
    #    instead of an arithmetic identity built from a magic number;
    #  * it survives a wage-table change. The previous version pinned 7850 paise/hr and
    #    the reference "KLS-2025-WAGE-44", both from the legacy STATUTORY_WAGES table
    #    whose source URLs do not resolve (checked 2026-09-11: UP 404, TN 404, RJ no
    #    DNS). When real notifications are transcribed into wage_table.json the numbers
    #    will change, and this test should pass then without being edited.
    hourly = price_res["inputs"]["hourly_wage_paise"]
    assert price_res["floor_amount_paise"] == 45000 + int(6.0 * hourly)
    assert price_res["recommended_low_paise"] > price_res["floor_amount_paise"]
    assert price_res["recommended_high_paise"] > price_res["recommended_low_paise"]
    # A price must always say where its wage rate came from, whatever that source is.
    assert price_res["wage_source"]["notification_ref"]
    assert price_res["wage_source"]["state_code"] == "KA"

    # 10. Confirm Listing Details (Artisan edits & confirmations)
    confirm_payload = {
        "catalogue": cat_result["catalogue"],
        "confirmed_fields": ["material_cost_paise", "materials", "techniques"],
        "corrections": []
    }
    res_confirm = client.post(f"/api/v1/listings/{listing_id}/confirm", json=confirm_payload, headers=artisan_headers)
    assert res_confirm.status_code == 200
    assert res_confirm.json()["status"] == "confirmed"

    # 11. Submit for Approval
    res_submit = client.post(f"/api/v1/listings/{listing_id}/submit-for-approval", headers=artisan_headers)
    assert res_submit.status_code == 200
    assert res_submit.json()["state"] == "awaiting_approval"

    # 12. Coordinator Reviews Statutory Claim (e.g. natural_dye / gi_tag)
    claim_review_req = {
        "decision": "verified",
        "evidence_note": "Verified master artisan registration card and cluster sample under Shilp Samagam.",
        "reason": None
    }
    res_claim = client.post(f"/api/v1/listings/{listing_id}/claims/gi_tag/review", json=claim_review_req, headers=coord_headers)
    assert res_claim.status_code == 200
    assert res_claim.json()["coordinator_verified"] is True

    # 13. Coordinator Approves Listing
    approval_req = {
        "decision": "approve",
        "reason": "All provenance claims verified and wage floor met."
    }
    res_approval = client.post(f"/api/v1/listings/{listing_id}/approval", json=approval_req, headers=coord_headers)
    assert res_approval.status_code == 200
    assert res_approval.json()["status"] == "approved"

    # 14. Export to ONDC Marketplace
    export_req = {
        "target": "ondc",
        "schema_version": "1.0",
        "simulate_network_submission": True
    }
    res_export = client.post(f"/api/v1/listings/{listing_id}/exports", json=export_req, headers=artisan_headers)
    assert res_export.status_code == 200, res_export.text
    export_res = res_export.json()
    assert export_res["status"] == "exported"
    assert export_res["payload_hash"].startswith("sha256:")
    assert export_res["contract_validation"]["passed"] is True
    assert export_res["network_submission"] == "success"

    # 15. Verify Final Listing State and Full Nested Structure
    res_final = client.get(f"/api/v1/listings/{listing_id}", headers=artisan_headers)
    assert res_final.status_code == 200
    final_data = res_final.json()
    assert final_data["state"] == "exported"
    assert len(final_data["media"]) >= 2
    assert final_data["catalogue"] is not None
    assert final_data["price"] is not None
    assert len(final_data["claims"]) >= 1

def test_invalid_state_wage_rate_error():
    uid = uuid.uuid4().hex[:6]
    # Test error code WAGE_RATE_UNAVAILABLE for unsupported state
    artisan_payload = {
        "username": f"artisan_err_{uid}",
        "email": f"err_{uid}@karigari.local",
        "password": "Password123!",
        "role": "artisan"
    }
    res = client.post("/api/v1/auth/register", json=artisan_payload)
    assert res.status_code == 200, res.text
    token = res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    res_listing = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=headers)
    listing_id = res_listing.json()["id"]

    # Full inputs, so the refusal tested here is the missing wage rate and not missing details.
    res_price = client.post(
        f"/api/v1/listings/{listing_id}/price",
        json={"state_code": "XX", "material_cost_paise": 45000, "labour_hours": 6, "skill_level": "skilled"},
        headers=headers,
    )
    assert res_price.status_code == 422
    err_body = res_price.json()
    assert "error" in err_body
    assert err_body["error"]["code"] == "WAGE_RATE_UNAVAILABLE"
