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
    assert job_result["quality"]["blur"] in ["low", "medium", "high"]
    assert len(job_result["transformations"]) > 0
    assert "enhanced_url" in job_result

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
    assert price_res["floor_amount_paise"] == 45000 + int(6.0 * 8719)  # ₹450 + 6 * ₹87.19 = ₹973.14 (97314 paise)
    assert price_res["recommended_low_paise"] > price_res["floor_amount_paise"]
    assert price_res["recommended_high_paise"] > price_res["recommended_low_paise"]
    assert "Karnataka Minimum Wages" in price_res["wage_source"]["notification_ref"]

    # 10. Confirm Listing Details (Artisan edits & confirmations)
    confirm_payload = {
        "catalogue": cat_result["catalogue"],
        "confirmed_fields": ["material_cost_paise", "materials", "techniques"],
        "corrections": []
    }
    res_confirm = client.post(f"/api/v1/listings/{listing_id}/confirm", json=confirm_payload, headers=artisan_headers)
    assert res_confirm.status_code == 200
    assert res_confirm.json()["status"] == "confirmed"

    # 11. Attempt Submit for Approval -> blocked due to unverified claims (gi_tag, natural_dye)
    res_submit = client.post(f"/api/v1/listings/{listing_id}/submit-for-approval", headers=artisan_headers)
    assert res_submit.status_code == 400
    assert res_submit.json()["error"]["code"] == "PROVENANCE_VERIFICATION_REQUIRED"

    # 12. Coordinator Reviews Statutory Claims (gi_tag and natural_dye)
    for claim_name in ["gi_tag", "natural_dye"]:
        claim_review_req = {
            "decision": "verified",
            "evidence_note": f"Verified {claim_name} artisan documentation.",
            "reason": None
        }
        res_claim = client.post(f"/api/v1/listings/{listing_id}/claims/{claim_name}/review", json=claim_review_req, headers=coord_headers)
        assert res_claim.status_code == 200
        assert res_claim.json()["coordinator_verified"] is True

    # 12b. Submit for Approval now succeeds
    res_submit_ok = client.post(f"/api/v1/listings/{listing_id}/submit-for-approval", headers=artisan_headers)
    assert res_submit_ok.status_code == 200
    assert res_submit_ok.json()["state"] == "awaiting_approval"

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
    assert export_res["status"] == "validated"
    assert export_res["payload_hash"].startswith("sha256:")
    assert export_res["contract_validation"]["passed"] is True
    assert export_res["network_submission"] == "not_attempted"

    # 15. Verify Final Listing State and Full Nested Structure
    res_final = client.get(f"/api/v1/listings/{listing_id}", headers=artisan_headers)
    assert res_final.status_code == 200
    final_data = res_final.json()
    assert final_data["state"] == "export_queued"
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

    res_price = client.post(f"/api/v1/listings/{listing_id}/price", json={"state_code": "XX"}, headers=headers)
    assert res_price.status_code == 200
    price_body = res_price.json()
    assert price_body["status"] == "unavailable"
    assert price_body["error_code"] == "WAGE_RATE_UNAVAILABLE"

    # Truly invalid input (negative material cost) must yield 422
    res_invalid = client.post(f"/api/v1/listings/{listing_id}/price", json={"material_cost_inr": -100}, headers=headers)
    assert res_invalid.status_code == 422
    assert res_invalid.json()["error"]["code"] == "INVALID_INPUT"


def test_master_craftsman_self_declared_claim_gating():
    uid = uuid.uuid4().hex[:6]
    artisan_payload = {
        "username": f"artisan_master_{uid}",
        "email": f"artisan_master_{uid}@karigari.local",
        "password": "Password123!",
        "role": "artisan"
    }
    res_artisan = client.post("/api/v1/auth/register", json=artisan_payload)
    assert res_artisan.status_code == 200
    artisan_headers = {"Authorization": f"Bearer {res_artisan.json()['access_token']}"}

    coord_payload = {
        "username": f"coord_master_{uid}",
        "email": f"coord_master_{uid}@mosje.gov.in",
        "password": "Password123!",
        "role": "coordinator"
    }
    res_coord = client.post("/api/v1/auth/register", json=coord_payload)
    assert res_coord.status_code == 200
    coord_headers = {"Authorization": f"Bearer {res_coord.json()['access_token']}"}

    # 1. Create listing
    res_listing = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=artisan_headers)
    assert res_listing.status_code == 200
    listing_id = res_listing.json()["id"]

    # 2. Price as self-declared highly_skilled
    price_req = {
        "material_cost_paise": 50000,
        "labour_hours": 10.0,
        "skill_level": "highly_skilled",
        "skill_level_source": "self_declared",
        "state_code": "KA",
        "zone": "zone_1"
    }
    res_price = client.post(f"/api/v1/listings/{listing_id}/price", json=price_req, headers=artisan_headers)
    assert res_price.status_code == 200

    # Verify claim was created and is unverified
    res_get = client.get(f"/api/v1/listings/{listing_id}", headers=artisan_headers)
    claims = res_get.json()["claims"]
    master_claim = next((c for c in claims if c["claim"] == "skill_level_master_self_declared"), None)
    assert master_claim is not None
    assert master_claim["coordinator_verified"] is False

    # 3. Attempt submit for approval -> must be blocked (HTTP 400)
    res_submit = client.post(f"/api/v1/listings/{listing_id}/submit-for-approval", headers=artisan_headers)
    assert res_submit.status_code == 400
    assert res_submit.json()["error"]["code"] == "PROVENANCE_VERIFICATION_REQUIRED"
    assert "skill_level_master_self_declared" in res_submit.json()["error"]["message"]

    # 4. Attempt coordinator approval -> must be blocked (HTTP 400)
    res_approve = client.post(f"/api/v1/listings/{listing_id}/approval", json={"decision": "approve"}, headers=coord_headers)
    assert res_approve.status_code == 400
    assert res_approve.json()["error"]["code"] == "PROVENANCE_VERIFICATION_REQUIRED"
    assert "skill_level_master_self_declared" in res_approve.json()["error"]["message"]

    # 5. Coordinator verifies the master craftsman claim
    review_req = {
        "decision": "verified",
        "evidence_note": "Verified master craftsman national award certificate.",
        "reason": None
    }
    res_review = client.post(
        f"/api/v1/listings/{listing_id}/claims/skill_level_master_self_declared/review",
        json=review_req,
        headers=coord_headers
    )
    assert res_review.status_code == 200
    assert res_review.json()["coordinator_verified"] is True

    # 6. Recalculate price -> IDEMPOTENCY GUARD: verification must NOT be reset!
    res_reprice = client.post(f"/api/v1/listings/{listing_id}/price", json=price_req, headers=artisan_headers)
    assert res_reprice.status_code == 200
    assert res_reprice.json()["inputs"]["skill_level_source"] == "coordinator_verified"

    res_get_after = client.get(f"/api/v1/listings/{listing_id}", headers=artisan_headers)
    claims_after = res_get_after.json()["claims"]
    master_claim_after = next((c for c in claims_after if c["claim"] == "skill_level_master_self_declared"), None)
    assert master_claim_after["coordinator_verified"] is True

    # 7. Now submit for approval -> succeeds
    res_submit_ok = client.post(f"/api/v1/listings/{listing_id}/submit-for-approval", headers=artisan_headers)
    assert res_submit_ok.status_code == 200
    assert res_submit_ok.json()["state"] == "awaiting_approval"

    # 8. Now coordinator approval -> succeeds
    res_approve_ok = client.post(f"/api/v1/listings/{listing_id}/approval", json={"decision": "approve"}, headers=coord_headers)
    assert res_approve_ok.status_code == 200
    assert res_approve_ok.json()["status"] == "approved"

    # 9. Test unblocked pathway: artisan_card_elevation does NOT create a blocking claim
    res_listing_card = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=artisan_headers)
    listing_card_id = res_listing_card.json()["id"]

    card_price_req = {
        "material_cost_paise": 50000,
        "labour_hours": 10.0,
        "skill_level": "highly_skilled",
        "skill_level_source": "artisan_card_elevation",
        "state_code": "KA",
        "zone": "zone_1"
    }
    res_card_price = client.post(f"/api/v1/listings/{listing_card_id}/price", json=card_price_req, headers=artisan_headers)
    assert res_card_price.status_code == 200

    res_get_card = client.get(f"/api/v1/listings/{listing_card_id}", headers=artisan_headers)
    assert not any(c["claim"] == "skill_level_master_self_declared" for c in res_get_card.json()["claims"])

    res_submit_card = client.post(f"/api/v1/listings/{listing_card_id}/submit-for-approval", headers=artisan_headers)
    assert res_submit_card.status_code == 200
    assert res_submit_card.json()["state"] == "awaiting_approval"


def test_artisan_profile_lifecycle():
    """Phase 2: Test profile submission, pending listing for coordinator, and review."""
    suffix = uuid.uuid4().hex[:6]
    artisan_headers = {
        "Authorization": f"Bearer {client.post('/api/v1/auth/register', json={'username': f'art_prof_{suffix}', 'password': 'Password123!', 'role': 'artisan'}).json()['access_token']}"
    }
    coord_headers = {
        "Authorization": f"Bearer {client.post('/api/v1/auth/register', json={'username': f'coord_prof_{suffix}', 'password': 'Password123!', 'role': 'coordinator'}).json()['access_token']}"
    }

    # 1. Initially profile is incomplete
    res_me = client.get("/api/v1/profile/artisan/me", headers=artisan_headers)
    assert res_me.status_code == 200
    assert res_me.json()["profile_status"] == "incomplete"

    # 2. Artisan submits profile
    submit_req = {
        "declared_skill_level": "highly_skilled",
        "declared_zone": "KA/zone_1",
        "id_proof_type": "pehchan_card",
        "id_proof_number": "PEHCHAN-9988-KA"
    }
    res_submit = client.post("/api/v1/profile/artisan", json=submit_req, headers=artisan_headers)
    assert res_submit.status_code == 200
    prof_data = res_submit.json()
    assert prof_data["profile_status"] == "pending_verification"
    assert prof_data["declared_skill_level"] == "highly_skilled"
    artisan_user_id = prof_data["user_id"]

    # 3. Coordinator lists pending profiles
    res_pending = client.get("/api/v1/profile/artisan/pending", headers=coord_headers)
    assert res_pending.status_code == 200
    pending_ids = [p["user_id"] for p in res_pending.json()]
    assert artisan_user_id in pending_ids

    # 4. Coordinator reviews and verifies
    review_req = {
        "decision": "verified",
        "reason": "Verified official Pehchan Card records on the DC Handicrafts portal."
    }
    res_review = client.post(f"/api/v1/profile/artisan/{artisan_user_id}/review", json=review_req, headers=coord_headers)
    assert res_review.status_code == 200
    verified_data = res_review.json()
    assert verified_data["profile_status"] == "verified"
    assert verified_data["verified_skill_level"] == "highly_skilled"
    assert verified_data["verified_by"] is not None


def test_verified_profile_skips_per_listing_claim_gate():
    """Phase 3: Artisan with verified highly_skilled profile declaring highly_skilled skips per-listing gate."""
    suffix = uuid.uuid4().hex[:6]
    artisan_res = client.post('/api/v1/auth/register', json={'username': f'art_v_{suffix}', 'password': 'Password123!', 'role': 'artisan'}).json()
    artisan_headers = {"Authorization": f"Bearer {artisan_res['access_token']}"}
    artisan_user_id = artisan_res["user_id"]

    coord_headers = {
        "Authorization": f"Bearer {client.post('/api/v1/auth/register', json={'username': f'coord_v_{suffix}', 'password': 'Password123!', 'role': 'coordinator'}).json()['access_token']}"
    }

    # Submit and verify profile as highly_skilled
    client.post("/api/v1/profile/artisan", json={
        "declared_skill_level": "highly_skilled",
        "declared_zone": "KA/zone_1",
        "id_proof_type": "pehchan_card",
        "id_proof_number": "KA-HS-1234"
    }, headers=artisan_headers)

    client.post(f"/api/v1/profile/artisan/{artisan_user_id}/review", json={"decision": "verified"}, headers=coord_headers)

    # Now create listing and calculate price declaring highly_skilled
    res_listing = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=artisan_headers)
    listing_id = res_listing.json()["id"]

    price_req = {
        "material_cost_paise": 50000,
        "labour_hours": 8.0,
        "skill_level": "highly_skilled",
        "skill_level_source": "self_declared",
        "state_code": "KA",
        "zone": "zone_1"
    }
    res_price = client.post(f"/api/v1/listings/{listing_id}/price", json=price_req, headers=artisan_headers)
    assert res_price.status_code == 200
    # Verified profile promotes skill_level_source to coordinator_verified
    assert res_price.json()["inputs"]["skill_level_source"] == "coordinator_verified"

    # Verify NO blocking claim was created on this listing
    res_get = client.get(f"/api/v1/listings/{listing_id}", headers=artisan_headers)
    assert not any(c["claim"] == "skill_level_master_self_declared" for c in res_get.json()["claims"])

    # Submit for approval should NOT be blocked by any claim
    res_submit = client.post(f"/api/v1/listings/{listing_id}/submit-for-approval", headers=artisan_headers)
    assert res_submit.status_code == 200
    assert res_submit.json()["state"] == "awaiting_approval"


def test_unverified_profile_still_uses_per_listing_gate():
    """Phase 3: Artisan with incomplete profile still gets per-listing claim gating."""
    suffix = uuid.uuid4().hex[:6]
    artisan_headers = {
        "Authorization": f"Bearer {client.post('/api/v1/auth/register', json={'username': f'art_unv_{suffix}', 'password': 'Password123!', 'role': 'artisan'}).json()['access_token']}"
    }

    res_listing = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=artisan_headers)
    listing_id = res_listing.json()["id"]

    price_req = {
        "material_cost_paise": 50000,
        "labour_hours": 8.0,
        "skill_level": "highly_skilled",
        "skill_level_source": "self_declared",
        "state_code": "KA",
        "zone": "zone_1"
    }
    res_price = client.post(f"/api/v1/listings/{listing_id}/price", json=price_req, headers=artisan_headers)
    assert res_price.status_code == 200

    # Unverified profile must retain self_declared and create blocking claim
    res_get = client.get(f"/api/v1/listings/{listing_id}", headers=artisan_headers)
    assert any(c["claim"] == "skill_level_master_self_declared" and not c["coordinator_verified"] for c in res_get.json()["claims"])

    # Submit for approval must be blocked (HTTP 400)
    res_submit = client.post(f"/api/v1/listings/{listing_id}/submit-for-approval", headers=artisan_headers)
    assert res_submit.status_code == 400


def test_profile_verified_at_lower_tier_does_not_auto_approve_higher_claim():
    """Phase 3: Profile verified at 'skilled' does NOT auto-approve 'highly_skilled' declaration."""
    suffix = uuid.uuid4().hex[:6]
    artisan_res = client.post('/api/v1/auth/register', json={'username': f'art_sk_{suffix}', 'password': 'Password123!', 'role': 'artisan'}).json()
    artisan_headers = {"Authorization": f"Bearer {artisan_res['access_token']}"}
    artisan_user_id = artisan_res["user_id"]

    coord_headers = {
        "Authorization": f"Bearer {client.post('/api/v1/auth/register', json={'username': f'coord_sk_{suffix}', 'password': 'Password123!', 'role': 'coordinator'}).json()['access_token']}"
    }

    # Verify profile at 'skilled'
    client.post("/api/v1/profile/artisan", json={
        "declared_skill_level": "skilled",
        "declared_zone": "KA/zone_1",
        "id_proof_type": "none"
    }, headers=artisan_headers)
    client.post(f"/api/v1/profile/artisan/{artisan_user_id}/review", json={"decision": "verified"}, headers=coord_headers)

    # Listing requests higher tier 'highly_skilled'
    res_listing = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=artisan_headers)
    listing_id = res_listing.json()["id"]

    price_req = {
        "material_cost_paise": 50000,
        "labour_hours": 8.0,
        "skill_level": "highly_skilled",
        "skill_level_source": "self_declared",
        "state_code": "KA",
        "zone": "zone_1"
    }
    res_price = client.post(f"/api/v1/listings/{listing_id}/price", json=price_req, headers=artisan_headers)
    assert res_price.status_code == 200

    # Must still fall back to per-listing gate for the higher tier
    res_get = client.get(f"/api/v1/listings/{listing_id}", headers=artisan_headers)
    assert any(c["claim"] == "skill_level_master_self_declared" and not c["coordinator_verified"] for c in res_get.json()["claims"])

    # Submission blocked
    res_submit = client.post(f"/api/v1/listings/{listing_id}/submit-for-approval", headers=artisan_headers)
    assert res_submit.status_code == 400


def test_profile_verification_rejects_missing_skill_level():
    """Phase 3/Pass 5: Verification fails with 422 if neither declared nor provided tier exists."""
    suffix = uuid.uuid4().hex[:6]
    artisan_res = client.post('/api/v1/auth/register', json={'username': f'art_empty_{suffix}', 'password': 'Password123!', 'role': 'artisan'}).json()
    artisan_user_id = artisan_res["user_id"]

    coord_headers = {
        "Authorization": f"Bearer {client.post('/api/v1/auth/register', json={'username': f'coord_empty_{suffix}', 'password': 'Password123!', 'role': 'coordinator'}).json()['access_token']}"
    }

    # Artisan user exists but has NOT declared a skill level (declared_skill_level is None)
    # Coordinator tries to verify without providing a verified_skill_level
    res_review = client.post(
        f"/api/v1/profile/artisan/{artisan_user_id}/review",
        json={"decision": "verified"},
        headers=coord_headers,
    )
    assert res_review.status_code == 422
    data = res_review.json()
    err_msg = data.get("detail") or data.get("error", {}).get("message", "")
    assert "no statutory skill level" in err_msg


def test_support_messages_lifecycle():
    """Test artisan submitting support messages with nullable listing_id and coordinator retrieval."""
    suffix = uuid.uuid4().hex[:6]
    artisan_res = client.post('/api/v1/auth/register', json={'username': f'art_supp_{suffix}', 'password': 'Password123!', 'role': 'artisan'}).json()
    artisan_headers = {"Authorization": f"Bearer {artisan_res['access_token']}"}

    coord_res = client.post('/api/v1/auth/register', json={'username': f'coord_supp_{suffix}', 'password': 'Password123!', 'role': 'coordinator'}).json()
    coord_headers = {"Authorization": f"Bearer {coord_res['access_token']}"}

    # 1. Submit general message (listing_id is None)
    gen_payload = {
        "listing_id": None,
        "message": "How do I calculate weaving hours for a double ikat saree?"
    }
    res_gen = client.post("/api/v1/support/messages", json=gen_payload, headers=artisan_headers)
    assert res_gen.status_code == 200, res_gen.text
    gen_data = res_gen.json()
    assert gen_data["listing_id"] is None
    assert gen_data["status"] == "open"
    assert gen_data["message"] == gen_payload["message"]
    assert gen_data["artisan_name"] == f"art_supp_{suffix}"

    # 2. Create listing and submit attached support message
    res_listing = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=artisan_headers)
    listing_id = res_listing.json()["id"]

    att_payload = {
        "listing_id": listing_id,
        "message": "Coordinator feedback requested on natural dye claim proof."
    }
    res_att = client.post("/api/v1/support/messages", json=att_payload, headers=artisan_headers)
    assert res_att.status_code == 200, res_att.text
    att_data = res_att.json()
    assert att_data["listing_id"] == listing_id
    assert att_data["status"] == "open"
    assert att_data["message"] == att_payload["message"]

    # 3. Empty message validation
    res_empty = client.post("/api/v1/support/messages", json={"listing_id": None, "message": "   "}, headers=artisan_headers)
    assert res_empty.status_code in [422, 400]

    # 4. Coordinator lists all support messages
    res_list = client.get("/api/v1/support/messages", headers=coord_headers)
    assert res_list.status_code == 200
    msg_ids = [m["id"] for m in res_list.json()]
    assert gen_data["id"] in msg_ids
    assert att_data["id"] in msg_ids

    # 5. Artisan lists own support messages
    res_art_list = client.get("/api/v1/support/messages", headers=artisan_headers)
    assert res_art_list.status_code == 200
    art_msg_ids = [m["id"] for m in res_art_list.json()]
    assert gen_data["id"] in art_msg_ids
    assert att_data["id"] in art_msg_ids


def test_generic_provenance_gate_blocks_natural_dye_and_gi_tag():
    """Verify get_unverified_claims catches non-master claims (natural_dye, gi_tag) across submission, approval, and export."""
    suffix = uuid.uuid4().hex[:6]
    artisan_headers = {
        "Authorization": f"Bearer {client.post('/api/v1/auth/register', json={'username': f'art_prov_{suffix}', 'password': 'Password123!', 'role': 'artisan'}).json()['access_token']}"
    }
    coord_headers = {
        "Authorization": f"Bearer {client.post('/api/v1/auth/register', json={'username': f'coord_prov_{suffix}', 'password': 'Password123!', 'role': 'coordinator'}).json()['access_token']}"
    }

    # Create listing
    res_listing = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=artisan_headers)
    listing_id = res_listing.json()["id"]

    # Price it (skilled level, no master claim)
    price_req = {
        "material_cost_paise": 30000,
        "labour_hours": 4.0,
        "skill_level": "skilled",
        "state_code": "KA"
    }
    client.post(f"/api/v1/listings/{listing_id}/price", json=price_req, headers=artisan_headers)

    # Directly add an unverified natural_dye claim to the listing
    from app.database import SessionLocal
    from app.models import ClaimModel
    db = SessionLocal()
    try:
        db.add(ClaimModel(
            listing_id=listing_id,
            claim="natural_dye",
            asserted_by_artisan=True,
            coordinator_verified=False
        ))
        db.commit()
    finally:
        db.close()

    # 1. Submit for approval -> must be blocked
    res_sub = client.post(f"/api/v1/listings/{listing_id}/submit-for-approval", headers=artisan_headers)
    assert res_sub.status_code == 400
    assert res_sub.json()["error"]["code"] == "PROVENANCE_VERIFICATION_REQUIRED"
    assert "natural_dye" in res_sub.json()["error"]["message"]

    # 2. Coordinator approval -> must be blocked
    res_app = client.post(f"/api/v1/listings/{listing_id}/approval", json={"decision": "approve"}, headers=coord_headers)
    assert res_app.status_code == 400
    assert res_app.json()["error"]["code"] == "PROVENANCE_VERIFICATION_REQUIRED"
    assert "natural_dye" in res_app.json()["error"]["message"]

    # 3. Export listing -> must be blocked immediately before export
    res_exp = client.post(f"/api/v1/listings/{listing_id}/exports", json={"target": "ondc"}, headers=artisan_headers)
    assert res_exp.status_code == 400
    assert res_exp.json()["error"]["code"] == "PROVENANCE_VERIFICATION_REQUIRED"
    assert "natural_dye" in res_exp.json()["error"]["message"]

    # 4. Now verify claim
    res_review = client.post(
        f"/api/v1/listings/{listing_id}/claims/natural_dye/review",
        json={"decision": "verified", "evidence_note": "Lab test verified"},
        headers=coord_headers
    )
    assert res_review.status_code == 200

    # 5. Now submit and approve succeed
    assert client.post(f"/api/v1/listings/{listing_id}/submit-for-approval", headers=artisan_headers).status_code == 200
    assert client.post(f"/api/v1/listings/{listing_id}/approval", json={"decision": "approve"}, headers=coord_headers).status_code == 200


def test_export_contract_invalid_on_missing_fields():
    """Verify export_listing validates required structural keys (images, price) and returns EXPORT_CONTRACT_INVALID."""
    suffix = uuid.uuid4().hex[:6]
    artisan_headers = {
        "Authorization": f"Bearer {client.post('/api/v1/auth/register', json={'username': f'art_inv_{suffix}', 'password': 'Password123!', 'role': 'artisan'}).json()['access_token']}"
    }

    # Create bare listing without media or price
    res_listing = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=artisan_headers)
    listing_id = res_listing.json()["id"]

    res_exp = client.post(f"/api/v1/listings/{listing_id}/exports", json={"target": "ondc"}, headers=artisan_headers)
    assert res_exp.status_code == 400
    err = res_exp.json()["error"]
    assert err["code"] == "EXPORT_CONTRACT_INVALID"




