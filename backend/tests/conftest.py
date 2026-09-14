"""
Configuration for the API integration suite.

`test_api_flow.py` exercises the artisan-to-coordinator pipeline end to end. It is a
test of the *flow*, not of wage data, so it needs a wage rate on file to reach the
steps after pricing.

The deterministic price engine refuses to price without a rate, and the shipped
`wage_table.json` carries none on purpose -- a floor computed from a guessed rate looks
authoritative and is not, which is the one error an artisan cannot detect. So this
suite runs against `wage_table.demo.json`, whose rates disclose themselves in the API
response (`notification_ref: DEMO-FIXTURE-...`, `source_url: unsourced://demo-fixture`).

The refusal behaviour itself is covered separately, in
`app/ai/tests/test_price_bridge.py::test_shipped_table_refuses_because_it_carries_no_rates`,
so making this suite pass does not paper over it.

Set before any app import so the flags are in force when the routers are constructed.
"""

from __future__ import annotations

import os
import tempfile

os.environ.setdefault("CRAFTLINK_WAGE_TABLE", "demo")
# Local sqlite unless the developer points DATABASE_URL somewhere explicitly. An
# integration suite must never be the thing that writes test rows into a shared
# database that other people are demoing from.
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_karigari.db")
# Same reasoning for uploaded files: a throwaway local directory, never a shared bucket.
os.environ.setdefault("CRAFTLINK_MEDIA_STORAGE", "local")
os.environ.setdefault("CRAFTLINK_MEDIA_DIR", tempfile.mkdtemp(prefix="craftlink-media-test-"))
# The flow test asserts the legacy transcription shape. Set here so a developer's
# CRAFTLINK_ASR in backend/.env (loaded by python-dotenv, which never overrides) cannot
# change it. Tests of the adapter path set the mode themselves.
os.environ.setdefault("CRAFTLINK_ASR", "legacy")
