"""
The Gemini status reported at GET /ai/config, with a fake probe and clock.
"""

from __future__ import annotations

import pytest

from app.ai import gemini_status as status_module
from app.ai.gemini_status import TTL_SECONDS, gemini_status


@pytest.fixture(autouse=True)
def empty_cache():
    status_module._cache.clear()
    yield
    status_module._cache.clear()


class _Probe:
    def __init__(self, outcome=(True, None)):
        self.outcome = outcome
        self.calls = []

    def __call__(self, model, api_key):
        self.calls.append(model)
        return self.outcome


def test_no_key_is_unknown_and_nothing_is_called(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    probe = _Probe()
    status = gemini_status(probe=probe)
    assert status["key_configured"] is False
    assert status["reachable"] is None
    assert probe.calls == []


def test_reports_what_the_model_answered(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("CRAFTLINK_GEMINI_MODEL", "gemini-2.5-flash")
    probe = _Probe((False, "HTTP 404: no longer available"))

    status = gemini_status(probe=probe)

    assert probe.calls == ["gemini-2.5-flash"]
    assert status["key_configured"] is True
    assert status["reachable"] is False
    assert status["detail"] == "HTTP 404: no longer available"
    assert status["checked_at"]


def test_probes_at_most_once_per_ttl(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    now = [1000.0]
    probe = _Probe()

    gemini_status(probe=probe, clock=lambda: now[0])
    now[0] += TTL_SECONDS - 1
    gemini_status(probe=probe, clock=lambda: now[0])
    assert len(probe.calls) == 1

    now[0] += 2
    gemini_status(probe=probe, clock=lambda: now[0])
    assert len(probe.calls) == 2


def test_changing_the_model_is_probed_again(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    probe = _Probe()
    monkeypatch.setenv("CRAFTLINK_GEMINI_MODEL", "gemini-3.5-flash")
    gemini_status(probe=probe)
    monkeypatch.setenv("CRAFTLINK_GEMINI_MODEL", "gemini-2.5-flash")
    gemini_status(probe=probe)
    assert probe.calls == ["gemini-3.5-flash", "gemini-2.5-flash"]


def test_the_key_never_appears_in_the_status_or_cache(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "secret-key-123")
    status = gemini_status(probe=_Probe())
    assert "secret-key-123" not in repr(status)
    assert "secret-key-123" not in repr(status_module._cache)
