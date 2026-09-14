"""
Feature flags for the AI layer.

Two independently-written AI implementations share `app/ai/` (see AI_MERGE_NOTES.md).
Rather than delete one, each capability is switchable, so the team can compare them on
the same request and decide with evidence instead of by argument.

Every flag is read from the environment at import time and has a documented default.

    CRAFTLINK_PRICE_ENGINE   deterministic | legacy   (default: deterministic)
    CRAFTLINK_WAGE_TABLE     <path> | demo            (default: the shipped empty table)
    CRAFTLINK_PROVENANCE     enforce | off            (default: enforce)
    CRAFTLINK_ASR            gemini | local | legacy  (default: legacy)
    CRAFTLINK_GEMINI_MODEL   <model name>             (default: gemini-3.5-flash)
    CRAFTLINK_CATALOGUE      gemini | legacy          (default: legacy)
    CRAFTLINK_IMAGE          studio | legacy          (default: legacy)
    CRAFTLINK_PHOTO_CHECK    gemini | off             (default: off)
    CRAFTLINK_SEGMENTATION_MODEL <rembg model>        (default: u2netp)

## Why the defaults are what they are

`CRAFTLINK_PRICE_ENGINE=deterministic` — the legacy path accepts `skill_level`, echoes
it back, and never uses it; all four levels return the same wage. The deterministic
engine honours it and implements the comparables asymmetry. Defaulting to the one that
works is the right way round even though it is stricter.

`CRAFTLINK_PROVENANCE=enforce` — an unverified GI identifier reaching a buyer is a
legal exposure, not a cosmetic bug. This default fails closed.

`CRAFTLINK_ASR=legacy` — `gemini` and `local` transcribe the file uploaded through
`POST /listings/{id}/media/upload`, and `gemini` walks `DEFAULT_ASR_PREFERENCE`, so the
provider that answered is stamped on the result. The frontend still sends placeholder
media ids instead of uploading, and with no uploaded file those modes refuse the job.
The default flips once the app uploads real recordings.

`CRAFTLINK_CATALOGUE=legacy` — `gemini` generates from a completed `gemini` or `local`
transcript and refuses without one, so it waits on the same frontend change.

`CRAFTLINK_IMAGE=legacy` — `studio` grades and enhances the uploaded photo with
`vision/` and refuses a job without one, so like speech it waits on the app uploading.

`CRAFTLINK_PHOTO_CHECK=off` — `gemini` sends each photo to Gemini as a second opinion,
which costs a request per photo against a free-tier limit of 5 per minute.
"""

from __future__ import annotations

import os
from pathlib import Path

_HERE = Path(__file__).resolve().parent


def _flag(name: str, default: str) -> str:
    return (os.getenv(name) or default).strip().lower()


# Read at call time, not import time.
#
# Import-time constants cannot be changed by a test that has already imported the app,
# which made the flags untestable and made suite ordering matter: whichever suite
# imported first froze the configuration for the rest of the session. Functions cost
# one environment lookup and make the behaviour honest.


def price_engine() -> str:
    return _flag("CRAFTLINK_PRICE_ENGINE", "deterministic")


def provenance_mode() -> str:
    return _flag("CRAFTLINK_PROVENANCE", "enforce")


def asr_mode() -> str:
    return _flag("CRAFTLINK_ASR", "legacy")


def wage_table_path() -> Path:
    """The wage table in force.

    `demo` selects a separate file whose every rate is stamped as a fixture in the API
    response itself, so a demo can run without a response that looks sourced. The
    default is the shipped table, which carries no rates and therefore refuses.
    """
    raw = os.getenv("CRAFTLINK_WAGE_TABLE", "").strip()
    if raw.lower() == "demo":
        return _HERE / "pricing" / "wage_table.demo.json"
    if raw:
        return Path(raw)
    return _HERE / "pricing" / "wage_table.json"


def use_deterministic_pricing() -> bool:
    return price_engine() == "deterministic"


def enforce_provenance() -> bool:
    return provenance_mode() == "enforce"


def use_local_asr() -> bool:
    return asr_mode() == "local"


def catalogue_mode() -> str:
    return _flag("CRAFTLINK_CATALOGUE", "legacy")


def image_mode() -> str:
    return _flag("CRAFTLINK_IMAGE", "legacy")


def photo_check_mode() -> str:
    return _flag("CRAFTLINK_PHOTO_CHECK", "off")


def segmentation_model() -> str:
    return (os.getenv("CRAFTLINK_SEGMENTATION_MODEL") or "u2netp").strip()


def gemini_model() -> str:
    # Not lowercased through _flag: model names are passed to the API verbatim.
    return (os.getenv("CRAFTLINK_GEMINI_MODEL") or "gemini-3.5-flash").strip()


def summary() -> dict[str, str]:
    """Surfaced at `GET /api/v1/ai/config` so a demo can state its own configuration."""
    return {
        "price_engine": price_engine(),
        "wage_table": wage_table_path().name,
        "provenance": provenance_mode(),
        "asr": asr_mode(),
        "catalogue": catalogue_mode(),
        "gemini_model": gemini_model(),
        "image_pipeline": image_mode(),
        "photo_check": photo_check_mode(),
        "segmentation_model": segmentation_model(),
    }
