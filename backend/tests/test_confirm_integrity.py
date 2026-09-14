"""
Confirming cannot store incomplete product details, and one bad stored catalogue cannot
break an artisan's list.

Found on 2026-09-14: a confirm with only labour and price fields created a catalogue with
no title or category, after which GET /listings returned 500 for that artisan.
"""

import json

from fastapi.testclient import TestClient

from app import models
from app.database import SessionLocal
from app.main import app
from tests.test_review_and_export import GOOD_CATALOGUE, _drafted, _post, _user

client = TestClient(app)


def test_confirming_without_generated_details_is_refused():
    artisan = _user("artisan")
    listing_id = _post("/listings", artisan, {"preferred_language": "kn"}).json()["id"]
    body = {"catalogue": {"labour": {"hours": 6}}, "confirmed_fields": [], "corrections": []}
    assert _post(f"/listings/{listing_id}/confirm", artisan, body).status_code == 409
    assert client.get(f"/api/v1/listings/{listing_id}", headers=artisan).status_code == 200


def test_confirming_cannot_blank_a_required_detail():
    artisan = _user("artisan")
    listing_id, _ = _drafted(artisan)
    body = {"catalogue": {**GOOD_CATALOGUE, "category": None}, "confirmed_fields": [], "corrections": []}
    res = _post(f"/listings/{listing_id}/confirm", artisan, body)
    assert res.status_code == 422
    assert "category" in res.json()["error"]["message"]
    assert client.get(f"/api/v1/listings/{listing_id}", headers=artisan).status_code == 200


def test_one_bad_stored_catalogue_does_not_break_the_list():
    artisan = _user("artisan")
    listing_id, _ = _drafted(artisan)
    db = SessionLocal()
    try:
        row = db.query(models.CatalogueModel).filter_by(listing_id=listing_id).one()
        row.catalogue_data = json.dumps({"labour": {"hours": 6}})
        db.commit()
    finally:
        db.close()

    res = client.get("/api/v1/listings", headers=artisan)
    assert res.status_code == 200
    assert [listing["catalogue"] for listing in res.json() if listing["id"] == listing_id] == [None]
