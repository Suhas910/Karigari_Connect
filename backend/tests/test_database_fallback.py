"""A set DATABASE_URL that cannot be reached stops the server; it is never swapped for SQLite."""

import pytest

from app.database import create_resilient_engine

UNREACHABLE = "postgresql://nobody:nothing@127.0.0.1:1/none"


def test_an_unreachable_database_is_refused_not_replaced(monkeypatch):
    monkeypatch.delenv("CRAFTLINK_ALLOW_SQLITE_FALLBACK", raising=False)
    with pytest.raises(RuntimeError, match="Refusing to fall back"):
        create_resilient_engine(UNREACHABLE, attempts=1, connect_timeout=1)


def test_sqlite_is_used_only_when_asked_for():
    engine = create_resilient_engine(UNREACHABLE, attempts=1, connect_timeout=1, allow_fallback=True)
    assert engine.url.drivername == "sqlite"
