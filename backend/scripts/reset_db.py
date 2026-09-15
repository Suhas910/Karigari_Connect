import sys
from sqlalchemy import text
from backend.app.database import SessionLocal, engine
from backend.app import models

def reset_database():
    db = SessionLocal()
    try:
        print("Connected to:", engine.url)
        
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
        
        # 9. Clear legacy images & products if any
        num_images = db.query(models.Image).delete()
        print(f"Deleted {num_images} legacy images")
        
        num_products = db.query(models.Product).delete()
        print(f"Deleted {num_products} legacy products")
        
        db.commit()
        print("Database commit successful! Listings/products/queues/history are now completely fresh.")
        
        # Verify counts
        print("Verification:")
        print("  Listings remaining:", db.query(models.ListingModel).count())
        print("  Products remaining:", db.query(models.Product).count())
        print("  Support messages remaining:", db.query(models.SupportMessageModel).count())
        print("  Users preserved:", db.query(models.User).count())
        
    except Exception as e:
        db.rollback()
        print(f"Error resetting database: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    reset_database()
