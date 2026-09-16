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


def ensure_sqlite_schema(eng):
    """Ensure SQLite database has all required columns if table already existed."""
    try:
        inspector = inspect(eng)
        if "users" in inspector.get_table_names():
            columns = {c["name"] for c in inspector.get_columns("users")}
            needed_columns = [
                ("profile_status", "VARCHAR(32) DEFAULT 'incomplete'"),
                ("declared_skill_level", "VARCHAR(32)"),
                ("declared_zone", "VARCHAR(64)"),
                ("id_proof_type", "VARCHAR(32) DEFAULT 'none'"),
                ("id_proof_number", "VARCHAR(64)"),
                ("verified_skill_level", "VARCHAR(32)"),
                ("verified_by", "INTEGER"),
                ("verified_at", "DATETIME"),
                ("phone_number", "VARCHAR(20)"),
            ]
            with eng.connect() as conn:
                for col_name, col_type in needed_columns:
                    if col_name not in columns:
                        try:
                            conn.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {col_type};"))
                            conn.commit()
                        except Exception as exc:
                            logger.warning("Failed to add column %s to SQLite users: %s", col_name, exc)
    except Exception as e:
        logger.warning("Error checking SQLite schema: %s", e)


def create_resilient_engine():
    target_url = DATABASE_URL
    if target_url:
        if target_url.startswith("postgresql://"):
            target_url = target_url.replace("postgresql://", "postgresql+psycopg2://", 1)
        # Attempt connection with 10-second timeout and 2 retries for serverless wake-up
        for attempt in range(1, 3):
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
                    "Attempt %d: Failed to connect to primary DATABASE_URL (%s).",
                    attempt,
                    exc,
                )
                if attempt < 2:
                    time.sleep(1)

    logger.warning("Falling back to local SQLite: %s", SQLITE_URL)
    ensure_sqlite_schema(sqlite_engine)
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


def init_db():
    """Initialize schemas and demo accounts on both primary and fallback engines."""
    from . import models  # Ensure all models are registered with Base.metadata

    # Initialize primary engine
    try:
        Base.metadata.create_all(bind=engine)
        seed_demo_users(engine)
    except Exception as exc:
        logger.warning("Failed initializing primary database: %s", exc)

    # Always ensure fallback SQLite engine is fully initialized and seeded
    try:
        ensure_sqlite_schema(sqlite_engine)
        Base.metadata.create_all(bind=sqlite_engine)
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

