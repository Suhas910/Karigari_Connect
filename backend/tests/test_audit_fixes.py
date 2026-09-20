import os
import uuid
import time
import ipaddress
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.database import SessionLocal, _should_seed_demo_users
from app.crypto import encrypt_pii, decrypt_pii, _resolve_encryption_key
from app.auth import _get_validated_secrets
from app.ssrf_protection import is_safe_ip, validate_safe_url
from app import models, schemas
from app.routers import ai as ai_router
from app.ai.service import ai_service, gemini_client
from fastapi import HTTPException

client = TestClient(app)
ADMIN_SECRET_HEADER = {"X-Admin-Secret": "karigari-connect-admin-bootstrap-dev-2026"}


# 1. Test Issue #1: Privilege Escalation at Signup
def test_self_registration_strictly_forces_artisan_role():
    suffix = uuid.uuid4().hex[:6]
    # Attempting to register as 'admin'
    res = client.post("/api/v1/auth/register", json={
        "username": f"hacker_admin_{suffix}",
        "password": "Password123!",
        "role": "admin"
    })
    assert res.status_code == 200
    assert res.json()["role"] == "artisan", "Self-signup must force role='artisan' even if caller asks for 'admin'!"

    # Attempting to register as 'coordinator' via public signup
    res_coord_attempt = client.post("/api/v1/auth/signup", json={
        "username": f"hacker_coord_{suffix}",
        "password": "Password123!",
        "role": "coordinator"
    })
    assert res_coord_attempt.status_code == 200
    assert res_coord_attempt.json()["role"] == "artisan", "Self-signup must force role='artisan' even if caller asks for 'coordinator'!"


def test_privileged_user_creation_requires_authorization():
    suffix = uuid.uuid4().hex[:6]
    payload = {
        "username": f"real_coord_{suffix}",
        "password": "Password123!",
        "role": "coordinator"
    }
    # Calling /admin/users without secret or admin auth -> 403
    res_unauth = client.post("/api/v1/auth/admin/users", json=payload)
    assert res_unauth.status_code == 403

    # Calling with valid X-Admin-Secret -> 200
    res_auth = client.post("/api/v1/auth/admin/users", json=payload, headers=ADMIN_SECRET_HEADER)
    assert res_auth.status_code == 200
    assert res_auth.json()["role"] == "coordinator"


# 2. Test Issue #2 & User Ask 2: Startup Guards for Production Secrets
def test_production_fail_fast_on_missing_secrets(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("SECRET_KEY", "karigari-connect-secure-dev-key-2026-sih")
    monkeypatch.setenv("ADMIN_SECRET_KEY", "real-admin-secret")

    with pytest.raises(RuntimeError, match="Insecure or missing SECRET_KEY in production"):
        _get_validated_secrets()

    monkeypatch.setenv("SECRET_KEY", "real-prod-secret-key-32chars-min!!")
    monkeypatch.setenv("ADMIN_SECRET_KEY", "karigari-connect-admin-bootstrap-dev-2026")
    with pytest.raises(RuntimeError, match="Insecure or missing ADMIN_SECRET_KEY in production"):
        _get_validated_secrets()


# 3. Test Issue #3: Demo Accounts Seeding Guard
def test_demo_accounts_gated_by_env(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("SEED_DEMO_USERS", raising=False)
    assert not _should_seed_demo_users(), "Demo seeding should be disabled by default in production"

    monkeypatch.setenv("ENVIRONMENT", "development")
    assert _should_seed_demo_users() is True

    monkeypatch.setenv("SEED_DEMO_USERS", "false")
    assert not _should_seed_demo_users()


# 4. Test Issue #4 & User Ask 3: SSRF Protection & IPv6 Scope
def test_ssrf_protection_scope():
    # IPv4 private/loopback/cloud metadata
    assert not is_safe_ip(ipaddress.ip_address("127.0.0.1"))
    assert not is_safe_ip(ipaddress.ip_address("10.0.0.1"))
    assert not is_safe_ip(ipaddress.ip_address("172.16.0.1"))
    assert not is_safe_ip(ipaddress.ip_address("192.168.1.1"))
    assert not is_safe_ip(ipaddress.ip_address("169.254.169.254"))

    # IPv6 loopback, link-local, ULA, and IPv4-mapped
    assert not is_safe_ip(ipaddress.ip_address("::1"))
    assert not is_safe_ip(ipaddress.ip_address("fe80::1"))
    assert not is_safe_ip(ipaddress.ip_address("fd00::1"))
    assert not is_safe_ip(ipaddress.ip_address("fc00::1"))
    assert not is_safe_ip(ipaddress.ip_address("::ffff:127.0.0.1"))
    assert not is_safe_ip(ipaddress.ip_address("::ffff:169.254.169.254"))

    # Safe public IPs
    assert is_safe_ip(ipaddress.ip_address("8.8.8.8"))
    assert is_safe_ip(ipaddress.ip_address("1.1.1.1"))


def test_ssrf_blocked_on_media_upload():
    suffix = uuid.uuid4().hex[:6]
    res_art = client.post("/api/v1/auth/register", json={"username": f"art_ssrf_{suffix}", "password": "Password123!"})
    headers = {"Authorization": f"Bearer {res_art.json()['access_token']}"}

    listing_res = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=headers)
    listing_id = listing_res.json()["id"]

    # Attempt SSRF targeting AWS metadata endpoint
    bad_payload = {"kind": "image", "url": "http://169.254.169.254/latest/meta-data/"}
    res_bad = client.post(f"/api/v1/listings/{listing_id}/media", json=bad_payload, headers=headers)
    assert res_bad.status_code == 400
    assert "Invalid or untrusted media URL" in res_bad.text

    # Attempt SSRF targeting localhost
    bad_local = {"kind": "image", "url": "http://127.0.0.1:8000/internal"}
    res_local = client.post(f"/api/v1/listings/{listing_id}/media", json=bad_local, headers=headers)
    assert res_local.status_code == 400


# 5. Test Issue #5: Media Upload Limits Enforcement
def test_media_upload_limits_enforced():
    suffix = uuid.uuid4().hex[:6]
    res_art = client.post("/api/v1/auth/register", json={"username": f"art_lim_{suffix}", "password": "Password123!"})
    headers = {"Authorization": f"Bearer {res_art.json()['access_token']}"}

    listing_res = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=headers)
    listing_id = listing_res.json()["id"]

    # 1. Invalid MIME type (e.g. text/plain for image)
    files = {"file": ("malicious.txt", b"plain text", "text/plain")}
    res_bad_mime = client.post(
        f"/api/v1/listings/{listing_id}/media",
        files=files,
        data={"kind": "image"},
        headers=headers
    )
    assert res_bad_mime.status_code == 400
    assert "Invalid image type" in res_bad_mime.text

    # 2. Oversized image (> 10 MB)
    large_payload = b"X" * (10485760 + 1)
    files_large = {"file": ("large.png", large_payload, "image/png")}
    res_large = client.post(
        f"/api/v1/listings/{listing_id}/media",
        files=files_large,
        data={"kind": "image"},
        headers=headers
    )
    assert res_large.status_code == 400
    assert "Image size exceeds 10 MB limit" in res_large.text


# 6. Test Issue #6 & User Ask 1: PII Encryption at Rest & Key Independence
def test_pii_encryption_at_rest_and_transparent_access():
    suffix = uuid.uuid4().hex[:6]
    res_art = client.post("/api/v1/auth/register", json={"username": f"art_enc_{suffix}", "password": "Password123!"})
    headers = {"Authorization": f"Bearer {res_art.json()['access_token']}"}
    user_id = res_art.json()["user_id"]

    # Update personal and bank details with Aadhaar and Account Number
    raw_aadhaar = "998877665544"
    raw_account = "123456789012345"

    client.put("/api/v1/profile/artisan/personal", json={"name_as_per_aadhaar": "Master Artisan"}, headers=headers)
    client.put("/api/v1/profile/artisan/business", json={"aadhaar_number": raw_aadhaar}, headers=headers)
    client.put("/api/v1/profile/artisan/bank", json={"account_number": raw_account}, headers=headers)

    # Inspect the raw SQL database to verify that the value stored in the database is NOT plaintext!
    db = SessionLocal()
    try:
        raw_row = db.execute(text(f"SELECT aadhaar_number, account_number FROM users WHERE user_id = {user_id}")).first()
        raw_db_aadhaar, raw_db_account = raw_row[0], raw_row[1]

        # Stored values must be encrypted ciphertext (starts with gAAAAA for Fernet)
        assert raw_db_aadhaar != raw_aadhaar
        assert raw_db_aadhaar.startswith("gAAAAA")
        assert raw_db_account != raw_account
        assert raw_db_account.startswith("gAAAAA")

        # Models transparently decrypt the value
        user = db.query(models.User).filter(models.User.user_id == user_id).first()
        assert user.aadhaar_number == raw_aadhaar
        assert user.account_number == raw_account
    finally:
        db.close()

    # Verify profile endpoint returns properly masked values
    res_prof = client.get("/api/v1/profile/artisan/me", headers=headers)
    assert res_prof.status_code == 200
    assert res_prof.json()["aadhaar_number"] == "********5544"
    assert res_prof.json()["account_number"] == "***********2345"


def test_encryption_key_production_guard(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("ENCRYPTION_KEY", raising=False)
    with pytest.raises(RuntimeError, match="Insecure or missing ENCRYPTION_KEY in production"):
        _resolve_encryption_key()


# 7. Test Issue #7: Logger Defined in routers/ai.py
def test_logger_defined_in_ai_router():
    assert hasattr(ai_router, "logger")
    assert ai_router.logger is not None


# 8. Test Issue #8: BiRefNet None Original Guard
def test_birefnet_none_original_safe_handling():
    # If a media ID is missing in database, originals list has None.
    # run_birefnet_image_job should safely handle without throwing AttributeError on None.url
    suffix = uuid.uuid4().hex[:6]
    res_art = client.post("/api/v1/auth/register", json={"username": f"art_biref_{suffix}", "password": "Password123!"})
    headers = {"Authorization": f"Bearer {res_art.json()['access_token']}"}
    listing_res = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=headers)
    listing_id = listing_res.json()["id"]

    job_id = str(uuid.uuid4())
    db = SessionLocal()
    try:
        job = models.JobModel(
            job_id=job_id,
            listing_id=listing_id,
            type="image_enhancement",
            status="pending"
        )
        db.add(job)
        db.commit()

        # Call with nonexistent media IDs
        ai_service.run_birefnet_image_job(
            job_id=job_id,
            original_media_ids=["nonexistent-1", "nonexistent-2"],
            base_url="http://testserver",
            engine="studio",
            background="studio"
        )

        db.refresh(job)
        # Should gracefully fail the job without raising uncaught AttributeError
        assert job.status == "failed"
    finally:
        db.close()


def test_gemini_client_audit_empty_or_none_url():
    """Verify gemini_client.audit_image_quality handles empty string or None safely."""
    res_empty = gemini_client.audit_image_quality("")
    assert res_empty["blur"] == "low"
    assert res_empty["lighting"] == "acceptable"
    assert isinstance(res_empty["guidance"], list)
    assert len(res_empty["guidance"]) > 0

    res_none = gemini_client.audit_image_quality(None)
    assert res_none["overall"] == "acceptable"
    assert isinstance(res_none["guidance"], list)
    assert len(res_none["guidance"]) > 0


# 9. Test Issue #9: Pricing Engine Reconciliation & WageRateUnavailable 422 Mapping
def test_pricing_engine_reconciled():
    suffix = uuid.uuid4().hex[:6]
    res_art = client.post("/api/v1/auth/register", json={"username": f"art_pr_{suffix}", "password": "Password123!"})
    headers = {"Authorization": f"Bearer {res_art.json()['access_token']}"}

    listing_res = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=headers)
    listing_id = listing_res.json()["id"]

    db = SessionLocal()
    try:
        # Calculate fair price via AIService
        res = ai_service.calculate_fair_price(
            listing_id=listing_id,
            material_cost_paise=20000,
            labour_hours=5.0,
            skill_level="skilled",
            state_code="KA",
            db=db
        )
        assert res.floor_amount_paise > 0
        assert res.recommended_low_paise > res.floor_amount_paise
        assert res.status == "available"
        assert res.currency == "INR"
    finally:
        db.close()


def test_pricing_wage_rate_unavailable_http_422_mapping():
    """Verify that unnotified state codes raise HTTPException(422) with WAGE_RATE_UNAVAILABLE error shape."""
    suffix = uuid.uuid4().hex[:6]
    res_art = client.post("/api/v1/auth/register", json={"username": f"art_p422_{suffix}", "password": "Password123!"})
    headers = {"Authorization": f"Bearer {res_art.json()['access_token']}"}

    listing_res = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=headers)
    listing_id = listing_res.json()["id"]

    db = SessionLocal()
    try:
        with pytest.raises(HTTPException) as exc_info:
            ai_service.calculate_fair_price(
                listing_id=listing_id,
                material_cost_paise=20000,
                labour_hours=5.0,
                skill_level="skilled",
                state_code="ZZ",  # Invalid/unnotified state code
                db=db
            )
        assert exc_info.value.status_code == 422
        assert exc_info.value.detail["code"] == "WAGE_RATE_UNAVAILABLE"
        assert exc_info.value.detail["recoverable"] is True
        assert "Statutory craft minimum wage is not officially notified" in exc_info.value.detail["message"]
    finally:
        db.close()


# 10. Test Issue #10: Legacy Products and Images Removed
def test_legacy_products_and_images_unmounted():
    # /products and /images should return 404
    res_prod = client.get("/products")
    assert res_prod.status_code == 404

    res_img = client.post("/users/1/products/1/post-image")
    assert res_img.status_code == 404


# 11 & 12. Test Issue #11 & #12: Redundant Route Aliases Compatibility
def test_route_aliases_work_identically():
    suffix = uuid.uuid4().hex[:6]
    res_art = client.post("/api/v1/auth/register", json={"username": f"art_al_{suffix}", "password": "Password123!"})
    headers = {"Authorization": f"Bearer {res_art.json()['access_token']}"}

    listing_res = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=headers)
    listing_id = listing_res.json()["id"]

    # Confirm listing
    client.post(f"/api/v1/listings/{listing_id}/confirm", json={
        "catalogue": {"title": {"en": "Alias Test"}},
        "confirmed_fields": ["title.en"],
        "corrections": []
    }, headers=headers)

    # Test alias: /submit-approval works identically to /submit-for-approval
    res_alias = client.post(f"/api/v1/listings/{listing_id}/submit-approval", headers=headers)
    assert res_alias.status_code == 200
    assert res_alias.json()["state"] == "awaiting_approval"


# 13. Test Issue #13: Database Failure Classification (Permanent vs Transient)
def test_is_permanent_db_failure_classification():
    from app.database import _is_permanent_db_failure

    permanent_errors = [
        # Host resolution / DNS failures (macOS, Linux, generic)
        'could not translate host name "ep-cold-db.neon.tech": nodename nor servname provided, or not known',
        'nodename nor servname provided, or not known',
        'psycopg2.OperationalError: Name or service not known',
        'dial tcp: lookup ep-cold-db.neon.tech: no such host',
        'java.net.UnknownHostException: unknown host: my-db.neon.tech',
        # Connection refusal (dead port / unreachable host)
        'could not connect to server: Connection refused (0x0000274D/10061)',
        'connection to server at "127.0.0.1", port 5432 failed: Connection refused',
        # Authentication and authorization
        'FATAL: password authentication failed for user "karigari_app"',
        'password authentication failed for user "postgres"',
        # Missing database or role
        'FATAL: database "karigari_prod" does not exist',
        'database "test_db" does not exist',
        'FATAL: role "karigari_admin" does not exist',
    ]

    for err_msg in permanent_errors:
        exc = Exception(err_msg)
        assert _is_permanent_db_failure(exc) is True, f"Expected permanent classification for: {err_msg}"

    transient_errors = [
        # Serverless wake-up / cold-start timeouts
        'connection timed out',
        'timeout expired',
        'canceling statement due to statement timeout',
        'server closed the connection unexpectedly',
        'SSL connection has been closed unexpectedly',
        'remaining connection slots are reserved for non-replication superuser connections',
        'FATAL: the database system is starting up',
        'FATAL: the database system is in recovery mode',
        'Operation timed out',
    ]

    for err_msg in transient_errors:
        exc = Exception(err_msg)
        assert _is_permanent_db_failure(exc) is False, f"Expected transient classification for: {err_msg}"


# 14. Test Issue #14: ensure_indexes Idempotency and Re-run Safety
def test_ensure_indexes_rerun_safety():
    from app.database import engine, ensure_indexes
    from sqlalchemy import text

    # First run (already runs on init_db, but test explicit invocation)
    ensure_indexes(engine)

    # Second run immediately after (simulating app restart against same DB)
    ensure_indexes(engine)

    # Third run to guarantee absolute idempotency
    ensure_indexes(engine)

    # Verify all expected indexes exist and are not duplicated
    with engine.connect() as conn:
        if engine.dialect.name == "sqlite":
            rows = conn.execute(text("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%';")).fetchall()
            found_names = [r[0] for r in rows]
        else:
            rows = conn.execute(text("SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%';")).fetchall()
            found_names = [r[0] for r in rows]

    expected_indexes = {
        "idx_listings_artisan_id",
        "idx_listings_state",
        "idx_listings_created_at",
        "idx_media_assets_listing_id",
        "idx_claims_listing_id",
        "idx_jobs_listing_id",
        "idx_export_records_listing_id",
        "idx_support_messages_artisan_id",
        "idx_support_messages_listing_id",
        "idx_support_messages_created_at",
    }

    # All expected indexes must be present
    for exp in expected_indexes:
        assert exp in found_names, f"Expected index {exp} not found in database: {found_names}"

    # No duplicate index names
    assert len(found_names) == len(set(found_names)), "Duplicate index names found in database metadata"


def test_rejection_categories_and_reason_lifecycle():
    """Verify rejection_categories validation, reason persistence, and clearing on approve."""
    suffix = uuid.uuid4().hex[:6]
    res_art = client.post("/api/v1/auth/register", json={"username": f"art_rej_{suffix}", "password": "Password123!", "role": "artisan"})
    art_headers = {"Authorization": f"Bearer {res_art.json()['access_token']}"}

    coord_payload = {
        "username": f"coord_rej_{suffix}",
        "password": "Password123!",
        "role": "coordinator"
    }
    res_coord = client.post("/api/v1/auth/admin/users", json=coord_payload, headers=ADMIN_SECRET_HEADER)
    assert res_coord.status_code == 200
    coord_headers = {"Authorization": f"Bearer {res_coord.json()['access_token']}"}

    # Create listing & submit
    list_res = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=art_headers)
    listing_id = list_res.json()["id"]

    # Submit for approval
    sub_res = client.post(f"/api/v1/listings/{listing_id}/submit-for-approval", headers=art_headers)
    assert sub_res.status_code == 200

    # 1. Invalid category rejected with 400
    invalid_rej = client.post(
        f"/api/v1/listings/{listing_id}/approval",
        json={"decision": "reject", "reason": "Bad quality", "rejection_categories": ["invalid_cat"]},
        headers=coord_headers,
    )
    assert invalid_rej.status_code == 400
    assert "Invalid rejection categories" in str(invalid_rej.json())

    # 2. Valid multi-select rejection persists categories and reason
    valid_rej = client.post(
        f"/api/v1/listings/{listing_id}/approval",
        json={"decision": "reject", "reason": "Photo blurry and price high", "rejection_categories": ["image", "price"]},
        headers=coord_headers,
    )
    assert valid_rej.status_code == 200
    rej_data = valid_rej.json()
    assert rej_data["status"] == "rejected"
    assert rej_data["reason"] == "Photo blurry and price high"
    assert "image" in rej_data["rejection_categories"]
    assert "price" in rej_data["rejection_categories"]

    # 3. GET /listings/{id} returns rejection_categories, rejection_flags, and rejection_reason
    get_res = client.get(f"/api/v1/listings/{listing_id}", headers=art_headers)
    assert get_res.status_code == 200
    listing_body = get_res.json()
    assert listing_body["state"] == "rejected"
    assert listing_body["rejection_categories"] == ["image", "price"]
    assert listing_body["rejection_flags"] == ["image", "price"]
    assert listing_body["rejection_reason"] == "Photo blurry and price high"

    # 4. On approval, rejection categories and reason clear
    # Set to awaiting_approval first
    db = SessionLocal()
    try:
        l = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
        l.state = "awaiting_approval"
        db.commit()
    finally:
        db.close()

    app_res = client.post(
        f"/api/v1/listings/{listing_id}/approval",
        json={"decision": "approve", "reason": "Approved after review"},
        headers=coord_headers,
    )
    assert app_res.status_code == 200
    assert app_res.json()["status"] == "approved"
    assert app_res.json()["rejection_categories"] == []

    get_app = client.get(f"/api/v1/listings/{listing_id}", headers=art_headers)
    assert get_app.json()["state"] == "approved"
    assert get_app.json()["rejection_categories"] == []
    assert get_app.json()["rejection_flags"] == []
    assert get_app.json()["rejection_reason"] is None


def test_coordinator_cannot_receive_artisan_bank_or_tax_fields():
    """Verify bank fields, PAN, and Aadhaar are strictly excluded over the wire when viewed by coordinator."""
    suffix = uuid.uuid4().hex[:6]

    # 1. Register artisan
    art_res = client.post(
        "/api/v1/auth/register",
        json={"username": f"art_bank_{suffix}", "password": "Password123!", "role": "artisan"},
    )
    assert art_res.status_code == 200
    art_token = art_res.json()["access_token"]
    art_headers = {"Authorization": f"Bearer {art_token}"}
    artisan_user_id = art_res.json()["user_id"]

    # 2. Artisan populates personal, business, and bank details
    client.put("/api/v1/profile/artisan/personal", json={"first_name": "Ramesh", "last_name": "Kumar"}, headers=art_headers)
    client.put(
        "/api/v1/profile/artisan/business",
        json={"pan_number": "ABCDE1234F", "aadhaar_number": "998877665544"},
        headers=art_headers,
    )
    client.put(
        "/api/v1/profile/artisan/bank",
        json={
            "account_holder_name": "Ramesh Kumar",
            "account_number": "987654321098",
            "ifsc_code": "SBIN0001234",
            "bank_name": "State Bank of India",
        },
        headers=art_headers,
    )
    client.post(
        "/api/v1/profile/artisan",
        json={"declared_skill_level": "skilled", "declared_zone": "KA-ZONE-1", "id_proof_type": "pehchan_card", "id_proof_number": "PEH123456"},
        headers=art_headers,
    )

    # 3. Artisan reading own profile receives bank and tax fields (account/aadhaar masked)
    art_profile = client.get("/api/v1/profile/artisan/me", headers=art_headers).json()
    assert art_profile["account_holder_name"] == "Ramesh Kumar"
    assert art_profile["account_number"] == "********1098"
    assert art_profile["ifsc_code"] == "SBIN0001234"
    assert art_profile["bank_name"] == "State Bank of India"
    assert art_profile["pan_number"] == "ABCDE1234F"
    assert art_profile["aadhaar_number"] == "********5544"

    # 4. Bootstrap coordinator
    coord_payload = {
        "username": f"coord_bank_{suffix}",
        "password": "Password123!",
        "role": "coordinator"
    }
    coord_res = client.post("/api/v1/auth/admin/users", json=coord_payload, headers=ADMIN_SECRET_HEADER)
    assert coord_res.status_code == 200
    coord_headers = {"Authorization": f"Bearer {coord_res.json()['access_token']}"}

    # 5. Coordinator fetching pending profiles list MUST NOT receive bank or tax fields
    pending_res = client.get("/api/v1/profile/artisan/pending", headers=coord_headers)
    assert pending_res.status_code == 200
    pending_profiles = pending_res.json()
    matched = [p for p in pending_profiles if p["user_id"] == artisan_user_id]
    assert len(matched) == 1
    coord_view = matched[0]

    assert coord_view["account_holder_name"] is None
    assert coord_view["account_number"] is None
    assert coord_view["ifsc_code"] is None
    assert coord_view["bank_name"] is None
    assert coord_view["pan_number"] is None
    assert coord_view["aadhaar_number"] is None

    # Public business / skill details are preserved
    assert coord_view["first_name"] == "Ramesh"
    assert coord_view["declared_skill_level"] == "skilled"
    assert coord_view["id_proof_number"] == "PEH123456"

    # 6. Coordinator fetching single artisan profile directly MUST NOT receive bank or tax fields
    direct_res = client.get(f"/api/v1/profile/artisan/{artisan_user_id}", headers=coord_headers)
    assert direct_res.status_code == 200
    direct_view = direct_res.json()
    assert direct_view["account_holder_name"] is None
    assert direct_view["account_number"] is None
    assert direct_view["ifsc_code"] is None
    assert direct_view["bank_name"] is None
    assert direct_view["pan_number"] is None
    assert direct_view["aadhaar_number"] is None

    # 7. Coordinator review response MUST NOT leak bank or tax fields
    review_res = client.post(
        f"/api/v1/profile/artisan/{artisan_user_id}/review",
        json={"decision": "verified"},
        headers=coord_headers,
    )
    assert review_res.status_code == 200
    review_view = review_res.json()
    assert review_view["account_holder_name"] is None
    assert review_view["account_number"] is None
    assert review_view["ifsc_code"] is None
    assert review_view["bank_name"] is None
    assert review_view["pan_number"] is None
    assert review_view["aadhaar_number"] is None


def test_support_thread_and_replies_lifecycle():
    """Verify support thread parent message fetch, reply posting, role badges, and access control."""
    suffix = uuid.uuid4().hex[:6]

    # 1. Register artisan and coordinator
    art_res = client.post("/api/v1/auth/register", json={
        "username": f"art_chat_{suffix}",
        "email": f"art_chat_{suffix}@test.com",
        "password": "Password123!",
        "role": "artisan",
        "first_name": "Ramesh",
        "last_name": "Kumar"
    })
    assert art_res.status_code == 200
    art_token = art_res.json()["access_token"]
    art_headers = {"Authorization": f"Bearer {art_token}"}

    coord_res = client.post("/api/v1/auth/admin/users", json={
        "username": f"coord_chat_{suffix}",
        "email": f"coord_chat_{suffix}@test.com",
        "password": "Password123!",
        "role": "coordinator",
        "first_name": "Ananya",
        "last_name": "Sharma"
    }, headers=ADMIN_SECRET_HEADER)
    assert coord_res.status_code == 200
    coord_token = coord_res.json()["access_token"]
    coord_headers = {"Authorization": f"Bearer {coord_token}"}

    other_res = client.post("/api/v1/auth/register", json={
        "username": f"other_chat_{suffix}",
        "email": f"other_chat_{suffix}@test.com",
        "password": "Password123!",
        "role": "artisan"
    })
    assert other_res.status_code == 200
    other_headers = {"Authorization": f"Bearer {other_res.json()['access_token']}"}

    # 2. Artisan creates support message
    create_res = client.post("/api/v1/support/messages", json={
        "message": "Please review my Channapatna toy GI tag claim."
    }, headers=art_headers)
    assert create_res.status_code == 200
    msg_id = create_res.json()["id"]

    # 3. GET /support/messages/{id} fetches single message for artisan and coordinator
    get_art = client.get(f"/api/v1/support/messages/{msg_id}", headers=art_headers)
    assert get_art.status_code == 200
    assert get_art.json()["message"] == "Please review my Channapatna toy GI tag claim."

    get_coord = client.get(f"/api/v1/support/messages/{msg_id}", headers=coord_headers)
    assert get_coord.status_code == 200
    assert get_coord.json()["id"] == msg_id

    # 4. Other artisan is forbidden
    get_other = client.get(f"/api/v1/support/messages/{msg_id}", headers=other_headers)
    assert get_other.status_code == 403

    # 5. Initially replies list is empty
    rep_res1 = client.get(f"/api/v1/support/messages/{msg_id}/replies", headers=art_headers)
    assert rep_res1.status_code == 200
    assert rep_res1.json() == []

    # 6. Coordinator replies to support message
    coord_reply = client.post(f"/api/v1/support/messages/{msg_id}/replies", json={
        "body": "Checking GI documentation in Mysore cluster registry."
    }, headers=coord_headers)
    assert coord_reply.status_code == 200
    rep_data1 = coord_reply.json()
    assert rep_data1["message_id"] == msg_id
    assert rep_data1["sender_role"] == "coordinator"
    assert rep_data1["sender_name"] == f"coord_chat_{suffix}"
    assert rep_data1["body"] == "Checking GI documentation in Mysore cluster registry."

    # 7. Artisan replies back
    art_reply = client.post(f"/api/v1/support/messages/{msg_id}/replies", json={
        "body": "Thank you, I have uploaded the certificate photos."
    }, headers=art_headers)
    assert art_reply.status_code == 200
    rep_data2 = art_reply.json()
    assert rep_data2["sender_role"] == "artisan"
    assert rep_data2["sender_name"] == f"art_chat_{suffix}"

    # 8. GET /support/messages/{id}/replies returns both replies in chronological order
    all_replies = client.get(f"/api/v1/support/messages/{msg_id}/replies", headers=coord_headers)
    assert all_replies.status_code == 200
    replies_list = all_replies.json()
    assert len(replies_list) == 2
    assert replies_list[0]["body"] == "Checking GI documentation in Mysore cluster registry."
    assert replies_list[1]["body"] == "Thank you, I have uploaded the certificate photos."

    # 9. Empty reply returns 422
    empty_reply = client.post(f"/api/v1/support/messages/{msg_id}/replies", json={"body": "   "}, headers=art_headers)
    assert empty_reply.status_code == 422

    # 10. Non-existent message returns 404
    missing_msg = client.get(f"/api/v1/support/messages/{uuid.uuid4()}/replies", headers=art_headers)
    assert missing_msg.status_code == 404


def test_delete_listing_endpoint():
    suffix = uuid.uuid4().hex[:6]
    art_res = client.post("/api/v1/auth/register", json={
        "username": f"del_art_{suffix}",
        "email": f"del_art_{suffix}@test.com",
        "password": "Password123!",
        "role": "artisan"
    })
    assert art_res.status_code == 200
    art_token = art_res.json()["access_token"]
    art_headers = {"Authorization": f"Bearer {art_token}"}

    # Create listing
    create_res = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=art_headers)
    assert create_res.status_code == 200
    listing_id = create_res.json()["id"]

    # Other artisan cannot delete
    other_res = client.post("/api/v1/auth/register", json={
        "username": f"del_other_{suffix}",
        "email": f"del_other_{suffix}@test.com",
        "password": "Password123!",
        "role": "artisan"
    })
    other_token = other_res.json()["access_token"]
    other_headers = {"Authorization": f"Bearer {other_token}"}

    forbidden_del = client.delete(f"/api/v1/listings/{listing_id}", headers=other_headers)
    assert forbidden_del.status_code == 403

    # Owner artisan deletes listing
    del_res = client.delete(f"/api/v1/listings/{listing_id}", headers=art_headers)
    assert del_res.status_code == 204

    # Fetching deleted listing returns 404
    get_res = client.get(f"/api/v1/listings/{listing_id}", headers=art_headers)
    assert get_res.status_code == 404



