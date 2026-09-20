import os
import sys
from pathlib import Path
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine

# Ensure backend directory is in sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))
repo_root = backend_dir.parent
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from app.database import SessionLocal, engine, SQLITE_URL
from app import models
from app.auth import hash_password

def clean_database(db, engine_url):
    print(f"\n--- Cleaning database at: {engine_url} ---")
    
    # 1. Clear support messages
    num_support = db.query(models.SupportMessageModel).delete()
    print(f"Deleted {num_support} support messages")
    
    # 2. Clear export records
    num_exports = db.query(models.ExportRecordModel).delete()
    print(f"Deleted {num_exports} export records")
    
    # 3. Clear jobs
    num_jobs = db.query(models.JobModel).delete()
    print(f"Deleted {num_jobs} jobs")
    
    # 4. Clear claims
    num_claims = db.query(models.ClaimModel).delete()
    print(f"Deleted {num_claims} claims")
    
    # 5. Clear price calculations
    num_prices = db.query(models.PriceCalculationModel).delete()
    print(f"Deleted {num_prices} price calculations")
    
    # 6. Clear catalogues
    num_cats = db.query(models.CatalogueModel).delete()
    print(f"Deleted {num_cats} catalogues")
    
    # 7. Clear media assets
    num_media = db.query(models.MediaAssetModel).delete()
    print(f"Deleted {num_media} media assets")
    
    # 8. Clear listings
    num_listings = db.query(models.ListingModel).delete()
    print(f"Deleted {num_listings} listings")

    # 9. Purge leftover test users (preserve official demo accounts)
    demo_usernames = {"artisan_demo", "coord_demo"}
    test_users = db.query(models.User).filter(~models.User.username.in_(demo_usernames)).all()
    num_test_users = len(test_users)
    for u in test_users:
        db.delete(u)
    print(f"Deleted {num_test_users} test users")

    # 10. Ensure artisan_demo is configured cleanly
    artisan = db.query(models.User).filter(models.User.username == "artisan_demo").first()
    if not artisan:
        artisan = models.User(
            username="artisan_demo",
            phone_number="9876543210",
            email="ramesh.artisan@example.com",
            hashed_password=hash_password("DemoPassword123!"),
            role="artisan",
            profile_status="verified",
            declared_skill_level="skilled",
            verified_skill_level="skilled",
            declared_zone="KA/zone_1",
            first_name="Ramesh",
            last_name="Kumar",
            business_name="Ramesh Clay Crafts",
        )
        db.add(artisan)
        print("Created clean artisan_demo user")
    else:
        artisan.role = "artisan"
        artisan.profile_status = "verified"
        artisan.declared_skill_level = "skilled"
        artisan.verified_skill_level = "skilled"
        artisan.declared_zone = "KA/zone_1"
        artisan.first_name = "Ramesh"
        artisan.last_name = "Kumar"
        artisan.business_name = "Ramesh Clay Crafts"
        artisan.hashed_password = hash_password("DemoPassword123!")
        print("Updated artisan_demo user to verified profile state")

    # 11. Ensure coord_demo is configured cleanly
    coord = db.query(models.User).filter(models.User.username == "coord_demo").first()
    if not coord:
        coord = models.User(
            username="coord_demo",
            phone_number="9876543211",
            email="coord_demo@karigari.local",
            hashed_password=hash_password("DemoPassword123!"),
            role="coordinator",
            profile_status="verified",
            first_name="Avinav",
            last_name="Kaushal",
            declared_zone="Karnataka & Uttar Pradesh Handloom Clusters",
            id_proof_type="ngo_card",
            id_proof_number="NGO-KA-2024-8891",
            business_address_line="Karnataka State Handloom Complex, Priyadarshini Bhavan",
            district="Bangalore Urban",
            city="Bengaluru",
            business_state_code="KA",
            pincode="560053",
        )
        db.add(coord)
        print("Created clean coord_demo user")
    else:
        coord.role = "coordinator"
        coord.profile_status = "verified"
        coord.first_name = "Avinav"
        coord.last_name = "Kaushal"
        coord.declared_zone = "Karnataka & Uttar Pradesh Handloom Clusters"
        coord.id_proof_type = "ngo_card"
        coord.id_proof_number = "NGO-KA-2024-8891"
        coord.business_address_line = "Karnataka State Handloom Complex, Priyadarshini Bhavan"
        coord.district = "Bangalore Urban"
        coord.city = "Bengaluru"
        coord.business_state_code = "KA"
        coord.pincode = "560053"
        coord.hashed_password = hash_password("DemoPassword123!")
        print("Updated coord_demo user to verified profile state")

    db.commit()
    print("Commit successful! Database is completely clean and ready.")
    
    # Verification
    print("Verification:")
    print("  Listings remaining:", db.query(models.ListingModel).count())
    print("  Support messages remaining:", db.query(models.SupportMessageModel).count())
    print("  Users preserved:")
    for u in db.query(models.User).all():
        print(f"    - [{u.role.upper()}] {u.username} (status: {u.profile_status}, name: {u.first_name} {u.last_name or ''})")


def reset_database():
    # 1. Clean primary configured database (Neon DB if reachable)
    db = SessionLocal()
    try:
        clean_database(db, engine.url)
    except Exception as e:
        db.rollback()
        print(f"Error resetting primary database: {e}", file=sys.stderr)
    finally:
        db.close()

    # 2. Also clean local SQLite database if primary was not SQLite
    if "sqlite" not in str(engine.url):
        sqlite_engine = create_engine(SQLITE_URL, connect_args={"check_same_thread": False})
        SqliteSession = sessionmaker(autocommit=False, autoflush=False, bind=sqlite_engine)
        sdb = SqliteSession()
        try:
            clean_database(sdb, sqlite_engine.url)
        except Exception as e:
            sdb.rollback()
            print(f"Error resetting local SQLite: {e}", file=sys.stderr)
        finally:
            sdb.close()

if __name__ == "__main__":
    reset_database()
