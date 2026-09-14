# backend/app/database.py
import os
import logging
import time
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

load_dotenv()
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL")
SQLITE_URL = "sqlite:///./karigari.db"

def create_resilient_engine(
    database_url: str | None = DATABASE_URL,
    *,
    attempts: int = 3,
    connect_timeout: int = 10,
    allow_fallback: bool | None = None,
):
    """The engine for DATABASE_URL, or SQLite when no URL is set.

    A set URL that cannot be reached is an error, not a reason to use SQLite. The fallback
    used to be silent, with a 3 second timeout: on 2026-09-14 a slow Neon connect after a
    restart put the server on a local karigari.db, so the app's listing stopped existing
    (404) and new rows went to a database nobody else could see. Retry, then refuse, unless
    CRAFTLINK_ALLOW_SQLITE_FALLBACK=1 asks for the old behaviour.
    """
    if allow_fallback is None:
        allow_fallback = os.getenv("CRAFTLINK_ALLOW_SQLITE_FALLBACK") == "1"
    target_url = database_url
    if target_url:
        if target_url.startswith("postgresql://"):
            target_url = target_url.replace("postgresql://", "postgresql+psycopg2://", 1)
        connect_args = {"connect_timeout": connect_timeout} if "postgresql" in target_url else {}
        eng = create_engine(target_url, connect_args=connect_args, pool_pre_ping=True)
        last_exc: Exception | None = None
        for attempt in range(1, attempts + 1):
            try:
                with eng.connect() as conn:
                    conn.execute(text("SELECT 1"))
                logger.info("Connected to primary database: %s", target_url.split("@")[-1])
                return eng
            except Exception as exc:
                last_exc = exc
                logger.warning("Database connection attempt %d of %d failed: %s", attempt, attempts, exc)
                if attempt < attempts:
                    time.sleep(2)
        eng.dispose()
        if not allow_fallback:
            raise RuntimeError(
                "DATABASE_URL is set but the database could not be reached. Refusing to fall back "
                "to SQLite, which would silently be a different database "
                "(set CRAFTLINK_ALLOW_SQLITE_FALLBACK=1 to allow it)."
            ) from last_exc
        logger.warning("Falling back to SQLite as CRAFTLINK_ALLOW_SQLITE_FALLBACK=1: %s", SQLITE_URL)

    eng = create_engine(
        SQLITE_URL,
        connect_args={"check_same_thread": False},
        pool_pre_ping=True,
    )
    logger.info("Using database: %s", SQLITE_URL)
    return eng

engine = create_resilient_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def add_missing_nullable_columns(eng, metadata) -> list[str]:
    """
    `create_all` creates missing tables but never alters existing ones, so a column added to
    a model would break every database created before it. Add nullable columns that are
    missing; they need no backfill. Anything else is left for a real migration.
    """
    from sqlalchemy import inspect

    added = []
    inspector = inspect(eng)
    existing_tables = set(inspector.get_table_names())
    with eng.begin() as conn:
        for table in metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            present = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in present or not column.nullable:
                    continue
                column_type = column.type.compile(dialect=eng.dialect)
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {column_type}'))
                added.append(f"{table.name}.{column.name}")
    if added:
        logger.info("Added missing columns: %s", ", ".join(added))
    return added

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
