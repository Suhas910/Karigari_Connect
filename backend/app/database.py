# backend/app/database.py
import os
import time
import logging
from pathlib import Path
from dotenv import load_dotenv

# Ensure .env in backend directory is loaded regardless of current working directory
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)
load_dotenv()

from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import sessionmaker, declarative_base

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL")
SQLITE_PATH = Path(__file__).resolve().parent.parent.parent / "karigari.db"
SQLITE_URL = f"sqlite:///{SQLITE_PATH}"

Base = declarative_base()

sqlite_engine = create_engine(
    SQLITE_URL,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)
SQLiteSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=sqlite_engine)


def ensure_user_schema_columns(eng):
    """
    Ensure the `users` table has every column models.py currently expects,
    adding any that are missing via ALTER TABLE.

    Base.metadata.create_all() only creates TABLES that don't exist yet — it
    never adds columns to a table that's already there. Without this running
    against the PRIMARY engine too (not just the SQLite fallback, which is
    all the old ensure_sqlite_schema() covered), the live Postgres/Neon DB
    silently drifts from models.py on every schema change, and the first
    write to a new column 500s in production while working fine locally
    against a fresh SQLite file.

    Column type strings below are plain ANSI-ish tokens (VARCHAR(n), BOOLEAN,
    JSON) that both SQLite (which doesn't enforce declared types on ALTER
    TABLE ADD COLUMN) and Postgres accept, so one list works for both engines.
    """
    try:
        inspector = inspect(eng)
        if "users" in inspector.get_table_names():
            columns = {c["name"] for c in inspector.get_columns("users")}
            needed_columns = [
                # --- pre-existing (kept for any engine that never ran this before) ---
                ("profile_status", "VARCHAR(32) DEFAULT 'incomplete'"),
                ("declared_skill_level", "VARCHAR(32)"),
                ("declared_zone", "VARCHAR(64)"),
                ("id_proof_type", "VARCHAR(32) DEFAULT 'none'"),
                ("id_proof_number", "VARCHAR(64)"),
                ("verified_skill_level", "VARCHAR(32)"),
                ("verified_by", "INTEGER"),
                ("verified_at", "DATETIME"),
                ("phone_number", "VARCHAR(20)"),
                # --- PROFILE-EXPANSION: personal ---
                ("first_name", "VARCHAR(100)"),
                ("middle_name", "VARCHAR(100)"),
                ("last_name", "VARCHAR(100)"),
                ("name_as_per_aadhaar", "VARCHAR(150)"),
                ("gender", "VARCHAR(20)"),
                ("profile_image_url", "VARCHAR(500)"),
                # --- PROFILE-EXPANSION: business ---
                ("business_name", "VARCHAR(200)"),
                ("brand_name", "VARCHAR(200)"),
                ("establishment_type", "VARCHAR(30)"),
                ("pan_number", "VARCHAR(10)"),
                ("aadhaar_number", "TEXT"),
                ("gst_registered", "BOOLEAN DEFAULT FALSE"),
                ("gst_number", "VARCHAR(15)"),
                ("enrollment_number", "VARCHAR(50)"),
                ("business_address_line", "VARCHAR(300)"),
                ("pincode", "VARCHAR(6)"),
                ("district", "VARCHAR(100)"),
                ("city", "VARCHAR(100)"),
                ("business_state_code", "VARCHAR(5)"),
                ("ondc_std_code", "VARCHAR(10)"),
                ("location_type", "VARCHAR(20)"),
                ("pickup_days", "JSON"),
                # --- PROFILE-EXPANSION: bank ---
                ("account_holder_name", "VARCHAR(150)"),
                ("account_number", "TEXT"),
                ("ifsc_code", "VARCHAR(11)"),
                ("bank_name", "VARCHAR(150)"),
            ]
            with eng.connect() as conn:
                for col_name, col_type in needed_columns:
                    if col_name not in columns:
                        try:
                            effective_type = "TIMESTAMP" if ("DATETIME" in col_type and eng.dialect.name == "postgresql") else col_type
                            conn.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {effective_type};"))
                            conn.commit()
                        except Exception as exc:
                            try:
                                conn.rollback()
                            except Exception:
                                pass
                            logger.warning("Failed to add column %s to users table (%s): %s", col_name, eng.dialect.name, exc)
                # Ensure existing Postgres columns can hold encrypted ciphertext
                if eng.dialect.name == "postgresql":
                    for pii_col in ["aadhaar_number", "account_number"]:
                        if pii_col in columns:
                            try:
                                conn.execute(text(f"ALTER TABLE users ALTER COLUMN {pii_col} TYPE TEXT;"))
                                conn.commit()
                            except Exception as exc:
                                logger.warning("Failed to alter column %s in users table (%s): %s", pii_col, eng.dialect.name, exc)
    except Exception as e:
        logger.warning("Error checking users table schema (%s): %s", eng.dialect.name, e)


def ensure_idempotency_columns(eng):
    """Ensure mutation models have idempotency_key column available across both SQLite and Postgres."""
    try:
        inspector = inspect(eng)
        table_names = set(inspector.get_table_names())
        tables_to_check = ["listings", "media_assets", "export_records", "support_messages"]
        with eng.connect() as conn:
            for tbl in tables_to_check:
                if tbl in table_names:
                    cols = {c["name"] for c in inspector.get_columns(tbl)}
                    if "idempotency_key" not in cols:
                        try:
                            conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN idempotency_key VARCHAR(100);"))
                            conn.commit()
                        except Exception as exc:
                            logger.warning("Failed to add idempotency_key to %s (%s): %s", tbl, eng.dialect.name, exc)
    except Exception as e:
        logger.warning("Error checking idempotency schema (%s): %s", eng.dialect.name, e)


def ensure_listing_schema_columns(eng):
    """Ensure `listings` table has rejection_categories and rejection_reason columns across SQLite and Postgres."""
    try:
        inspector = inspect(eng)
        if "listings" in inspector.get_table_names():
            columns = {c["name"] for c in inspector.get_columns("listings")}
            needed_columns = [
                ("rejection_categories", "JSON"),
                ("rejection_reason", "TEXT"),
            ]
            with eng.connect() as conn:
                for col_name, col_type in needed_columns:
                    if col_name not in columns:
                        try:
                            conn.execute(text(f"ALTER TABLE listings ADD COLUMN {col_name} {col_type};"))
                            conn.commit()
                        except Exception as exc:
                            try:
                                conn.rollback()
                            except Exception:
                                pass
                            logger.warning("Failed to add column %s to listings table (%s): %s", col_name, eng.dialect.name, exc)
    except Exception as e:
        logger.warning("Error checking listings table schema (%s): %s", eng.dialect.name, e)


def ensure_indexes(eng):
    """Ensure high-traffic query filters and foreign keys have indexes across both SQLite and Postgres."""
    indexes = [
        ("idx_listings_artisan_id", "listings", "artisan_id"),
        ("idx_listings_state", "listings", "state"),
        ("idx_listings_created_at", "listings", "created_at DESC"),
        ("idx_media_assets_listing_id", "media_assets", "listing_id"),
        ("idx_claims_listing_id", "claims", "listing_id"),
        ("idx_jobs_listing_id", "jobs", "listing_id"),
        ("idx_export_records_listing_id", "export_records", "listing_id"),
        ("idx_support_messages_artisan_id", "support_messages", "artisan_id"),
        ("idx_support_messages_listing_id", "support_messages", "listing_id"),
        ("idx_support_messages_created_at", "support_messages", "created_at DESC"),
        ("idx_support_replies_message_id", "support_message_replies", "message_id"),
        ("idx_support_replies_created_at", "support_message_replies", "created_at ASC"),
    ]
    try:
        with eng.connect() as conn:
            for idx_name, tbl, cols in indexes:
                try:
                    conn.execute(text(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {tbl} ({cols});"))
                    conn.commit()
                except Exception as exc:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                    logger.warning("Failed to ensure index %s on %s: %s", idx_name, tbl, exc)
    except Exception as e:
        logger.warning("Error checking index schema (%s): %s", eng.dialect.name, e)


def _is_permanent_db_failure(exc: Exception) -> bool:
    err_str = str(exc).lower()
    phrases = [
        "could not translate host name",
        "nodename nor servname provided",
        "name or service not known",
        "connection refused",
        "password authentication failed",
        "no such host",
        "unknown host",
    ]
    if any(phrase in err_str for phrase in phrases):
        return True
    if "does not exist" in err_str and ("database" in err_str or "role" in err_str):
        return True
    return False


def create_resilient_engine():
    target_url = DATABASE_URL
    is_prod = os.getenv("ENVIRONMENT", os.getenv("ENV", "development")).lower() in ("production", "prod")
    max_attempts = 3 if is_prod else 2

    if target_url:
        if target_url.startswith("postgresql://"):
            target_url = target_url.replace("postgresql://", "postgresql+psycopg2://", 1)

        for attempt in range(1, max_attempts + 1):
            try:
                connect_args = {"connect_timeout": 10} if "postgresql" in target_url else {}
                eng = create_engine(
                    target_url,
                    connect_args=connect_args,
                    pool_pre_ping=True,
                    pool_recycle=300,
                )
                with eng.connect() as conn:
                    conn.execute(text("SELECT 1"))
                logger.info("Connected to primary database: %s", target_url.split("@")[-1])
                return eng
            except Exception as exc:
                logger.warning(
                    "Attempt %d/%d: Failed to connect to primary DATABASE_URL (%s).",
                    attempt,
                    max_attempts,
                    exc,
                )
                # In non-production, fail fast immediately on unresolvable hostnames or bad credentials
                if not is_prod and _is_permanent_db_failure(exc):
                    logger.info("Permanent database connection failure detected in non-prod. Failing over without delay.")
                    break
                if attempt < max_attempts:
                    time.sleep(1.5)

    logger.warning("Falling back to local SQLite: %s", SQLITE_URL)
    return sqlite_engine


engine = create_resilient_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def seed_demo_users(target_engine):
    """Seed demo accounts if missing on the target engine."""
    from .models import User
    from .auth import hash_password

    Session = sessionmaker(bind=target_engine)
    db = Session()
    try:
        artisan = db.query(User).filter(User.username == "artisan_demo").first()
        if not artisan:
            db.add(
                User(
                    username="artisan_demo",
                    phone_number="9876543210",
                    hashed_password=hash_password("DemoPassword123!"),
                    role="artisan",
                    profile_status="incomplete",
                )
            )
        coord = db.query(User).filter(User.username == "coord_demo").first()
        if not coord:
            db.add(
                User(
                    username="coord_demo",
                    phone_number="9876543211",
                    hashed_password=hash_password("DemoPassword123!"),
                    role="coordinator",
                    profile_status="verified",
                )
            )
        db.commit()
    except Exception as err:
        db.rollback()
        logger.warning("Could not auto-seed demo users on %s: %s", target_engine.url, err)
    finally:
        db.close()


def _should_seed_demo_users() -> bool:
    env = os.getenv("ENVIRONMENT", os.getenv("ENV", "development")).lower()
    explicit_flag = os.getenv("SEED_DEMO_USERS")
    if explicit_flag is not None:
        return explicit_flag.strip().lower() in ("1", "true", "yes")
    return env in ("development", "dev", "test")


def init_db():
    """Initialize schemas, apply column/index migrations, and conditionally seed demo accounts."""
    from . import models  # Ensure all models are registered with Base.metadata

    should_seed = _should_seed_demo_users()
    if not should_seed:
        logger.info("Demo user auto-seeding is disabled (production or SEED_DEMO_USERS=false).")

    # Initialize primary engine
    try:
        Base.metadata.create_all(bind=engine)
        ensure_user_schema_columns(engine)
        ensure_listing_schema_columns(engine)
        ensure_idempotency_columns(engine)
        ensure_indexes(engine)
        if should_seed:
            seed_demo_users(engine)
    except Exception as exc:
        logger.warning("Failed initializing primary database: %s", exc)

    # Always ensure fallback SQLite engine is fully initialized and seeded
    try:
        Base.metadata.create_all(bind=sqlite_engine)
        ensure_user_schema_columns(sqlite_engine)
        ensure_listing_schema_columns(sqlite_engine)
        ensure_idempotency_columns(sqlite_engine)
        ensure_indexes(sqlite_engine)
        if should_seed:
            seed_demo_users(sqlite_engine)
    except Exception as exc:
        logger.warning("Failed initializing fallback SQLite database: %s", exc)


def get_db():
    """Dependency that yields a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

