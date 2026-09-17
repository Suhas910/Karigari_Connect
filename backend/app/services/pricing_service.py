"""
pricing_service.py

Heuristic, deterministic price engine for CraftLink.
No LLM in the loop here — pure formula, fully explainable, fully testable.

floor_amount = material_cost + (labour_hours * hourly_wage)
band = floor * margin multipliers (skill/technique aware)

Never returns a guessed price when wage data is missing.
"""

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

DATA_DIR = Path(__file__).parent / "data" if (Path(__file__).parent / "data").exists() else Path(__file__).parent.parent / "data"
WAGE_RATES_PATH = DATA_DIR / "wage_rates.json"
TECHNIQUE_MULTIPLIERS_PATH = DATA_DIR / "technique_multipliers.json"
SKILL_FLOOR_PATH = DATA_DIR / "technique_skill_floor.json"

CALCULATION_VERSION = "1.0.0"

SKILL_RANK = {
    "unskilled": 0,
    "semi_skilled": 1,
    "skilled": 2,
    "highly_skilled": 3,
}


class WageRateUnavailable(Exception):
    """Raised when no wage entry exists for state_code + skill_level."""
    pass


@dataclass
class WageRate:
    state_code: str
    zone: str
    skill_level: str
    hourly_wage_inr: float
    daily_wage_inr: float
    notification_ref: str
    effective_from: str
    source_url: str
    effective_to: Optional[str] = None
    caution: Optional[str] = None

    @classmethod
    def from_dict(cls, d: dict) -> "WageRate":
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in d.items() if k in known})


@dataclass
class PriceResult:
    calculation_version: str
    status: str  # "available" | "unavailable"
    currency: str
    wage_source: Optional[dict]
    inputs: dict
    floor_amount_inr: Optional[float]
    recommended_low_inr: Optional[float]
    recommended_high_inr: Optional[float]
    explanation: str
    error_code: Optional[str] = None
    fallback_suggestion: Optional[dict] = None


ZONE_ALIASES: dict[str, str] = {
    "zone_a": "zone_1",
    "zone_b": "zone_2",
    "zone_c": "zone_3",
    "zone_d": "zone_4",
    "zone_1": "zone_a",
    "zone_2": "zone_b",
    "zone_3": "zone_c",
    "zone_4": "zone_d",
}


def _load_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_wage_rate(state_code: str, skill_level: str, zone: str = "zone_1") -> Optional[WageRate]:
    """
    Looks up official wage rate for (state_code, skill_level, zone).
    Falls back to 'statewide' if specific zone not found
    (e.g. state has no zone system, only 'statewide').

    Note on wage_rates.json hourly rates:
    hourly_wage_inr = ROUND_HALF_UP(daily_wage_inr / 8, 2 decimals) — not Python's round().
    Standard commercial half-up rounding protects artisans from floating-point / banker's underpayment.
    """
    sc = "DD" if state_code.upper() == "DN" else state_code.upper()
    data = _load_json(WAGE_RATES_PATH)
    candidates = [
        r for r in data["rates"]
        if r["state_code"] == sc and r["skill_level"] == skill_level
    ]
    if not candidates:
        return None

    # prefer exact zone match, else normalized alias, else fall back to 'statewide', else first available
    for r in candidates:
        if r["zone"] == zone:
            return WageRate.from_dict(r)
    alias = ZONE_ALIASES.get(zone)
    if alias:
        for r in candidates:
            if r["zone"] == alias:
                return WageRate.from_dict(r)
    for r in candidates:
        if r["zone"] == "statewide":
            return WageRate.from_dict(r)
    return WageRate.from_dict(candidates[0])


def resolve_effective_skill_level(self_declared: str, techniques: list[str]) -> str:
    """
    Effective skill_level = max(self_declared, technique_floor).
    Protects artisan from under-declaring own skill.
    """
    floors = _load_json(SKILL_FLOOR_PATH) if SKILL_FLOOR_PATH.exists() else {}
    technique_floor_map = floors.get("technique_skill_floor", {})

    effective_rank = SKILL_RANK.get(self_declared, 0)
    for t in techniques:
        floor_level = technique_floor_map.get(t)
        if floor_level:
            effective_rank = max(effective_rank, SKILL_RANK.get(floor_level, 0))

    for name, rank in SKILL_RANK.items():
        if rank == effective_rank:
            return name
    return self_declared


def get_technique_multiplier(techniques: list[str]) -> float:
    """
    Small versioned lookup, stacks multiplicatively but capped.
    Default 1.0 if no techniques matched or file missing.
    """
    if not TECHNIQUE_MULTIPLIERS_PATH.exists():
        return 1.0
    data = _load_json(TECHNIQUE_MULTIPLIERS_PATH)
    mult_map = data.get("multipliers", {})
    multiplier = 1.0
    for t in techniques:
        multiplier *= mult_map.get(t, 1.0)
    # cap to avoid runaway stacking on many techniques
    return min(multiplier, 1.5)


def calculate_price(
    material_cost_inr: float,
    labour_hours: float,
    state_code: str,
    skill_level: str,
    techniques: Optional[list[str]] = None,
    comparables: Optional[list[float]] = None,
    zone: str = "zone_1",
    skill_level_source: Optional[str] = None,
) -> PriceResult:
    techniques = techniques or []
    comparables = comparables or []

    if material_cost_inr < 0 or labour_hours <= 0:
        return PriceResult(
            calculation_version=CALCULATION_VERSION,
            status="unavailable",
            currency="INR",
            wage_source=None,
            inputs={
                "material_cost_inr": material_cost_inr,
                "labour_hours": labour_hours,
                "skill_level": skill_level,
                "skill_level_self_declared": skill_level,
                "skill_level_source": skill_level_source or "self_declared",
                "state_code": state_code,
                "zone": zone,
                "techniques": techniques,
            },
            floor_amount_inr=None,
            recommended_low_inr=None,
            recommended_high_inr=None,
            explanation="Invalid inputs: material cost cannot be negative, labour hours must be positive.",
            error_code="INVALID_INPUT",
        )

    effective_skill = resolve_effective_skill_level(skill_level, techniques)
    if skill_level_source is None:
        if effective_skill != skill_level:
            skill_level_source = "technique_floor"
        else:
            skill_level_source = "self_declared"

    wage = get_wage_rate(state_code, effective_skill, zone=zone)

    if wage is None:
        fallback_suggestion = None
        if effective_skill == "highly_skilled":
            skilled_wage = get_wage_rate(state_code, "skilled", zone=zone)
            if skilled_wage:
                fallback_suggestion = {
                    "used_tier": "skilled",
                    "hourly_wage_inr": skilled_wage.hourly_wage_inr,
                    "note": (
                        "This state's official schedule does not publish a highly_skilled rate. "
                        "Showing the next available tier (skilled) for reference only — a coordinator "
                        "must confirm before this is used as a price floor."
                    ),
                }

        return PriceResult(
            calculation_version=CALCULATION_VERSION,
            status="unavailable",
            currency="INR",
            wage_source=None,
            inputs={
                "material_cost_inr": material_cost_inr,
                "labour_hours": labour_hours,
                "skill_level": effective_skill,
                "skill_level_self_declared": skill_level,
                "skill_level_source": skill_level_source,
                "state_code": state_code,
                "zone": zone,
                "techniques": techniques,
            },
            floor_amount_inr=None,
            recommended_low_inr=None,
            recommended_high_inr=None,
            explanation=(
                f"No verified wage rate available for {state_code} / {effective_skill}. "
                "Price withheld — never guessed."
            ),
            error_code="WAGE_RATE_UNAVAILABLE",
            fallback_suggestion=fallback_suggestion,
        )

    labour_cost = labour_hours * wage.hourly_wage_inr
    floor_amount = material_cost_inr + labour_cost

    technique_multiplier = get_technique_multiplier(techniques)

    recommended_low = floor_amount * 1.15
    recommended_high = floor_amount * 1.6 * technique_multiplier

    # nudge high toward median comparable if given, never below floor
    if comparables:
        median_comp = sorted(comparables)[len(comparables) // 2]
        recommended_high = max(floor_amount, min(recommended_high, median_comp * 1.1))
        recommended_high = max(recommended_high, recommended_low)

    explanation = (
        f"Includes ₹{material_cost_inr:.0f} materials + {labour_hours:.1f}h @ "
        f"₹{wage.hourly_wage_inr:.2f}/hr ({effective_skill}, {state_code}). "
        f"Wage source: {wage.notification_ref}."
    )
    if wage.caution:
        explanation += f" Note: {wage.caution}"

    return PriceResult(
        calculation_version=CALCULATION_VERSION,
        status="available",
        currency="INR",
        wage_source={
            "state_code": wage.state_code,
            "zone": wage.zone,
            "notification_ref": wage.notification_ref,
            "effective_from": wage.effective_from,
            "effective_to": wage.effective_to,
            "source_url": wage.source_url,
        },
        inputs={
            "material_cost_inr": material_cost_inr,
            "labour_hours": labour_hours,
            "hourly_wage_inr": wage.hourly_wage_inr,
            "skill_level": effective_skill,
            "skill_level_self_declared": skill_level,
            "skill_level_source": skill_level_source,
            "state_code": state_code,
            "zone": wage.zone,
            "techniques": techniques,
        },
        floor_amount_inr=round(floor_amount, 2),
        recommended_low_inr=round(recommended_low, 2),
        recommended_high_inr=round(recommended_high, 2),
        explanation=explanation,
    )