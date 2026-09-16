import pytest
from app.services.pricing_service import (
    calculate_price,
    get_wage_rate,
    resolve_effective_skill_level,
    get_technique_multiplier,
)


# ---------- get_wage_rate ----------

class TestGetWageRate:
    def test_valid_ka_zone1_skilled(self):
        rate = get_wage_rate("KA", "skilled", zone="zone_1")
        assert rate is not None
        assert rate.state_code == "KA"
        assert rate.hourly_wage_inr == 87.19

    def test_up_falls_back_to_statewide(self):
        # UP has no zone system, requesting zone_1 should still resolve via statewide fallback
        rate = get_wage_rate("UP", "unskilled", zone="zone_1")
        assert rate is not None
        assert rate.zone == "statewide"
        assert rate.hourly_wage_inr == 53.0

    def test_missing_state_returns_none(self):
        rate = get_wage_rate("TN", "skilled")
        assert rate is None

    def test_missing_skill_level_for_known_state_returns_none(self):
        rate = get_wage_rate("UP", "highly_skilled")  # UP fixture only has unskilled/semi/skilled
        assert rate is None

    def test_karnataka_carries_litigation_caution(self):
        rate = get_wage_rate("KA", "unskilled")
        assert rate.caution is not None
        assert "legal challenge" in rate.caution.lower()


# ---------- resolve_effective_skill_level ----------

class TestResolveEffectiveSkillLevel:
    def test_self_declared_wins_when_no_technique_floor(self):
        result = resolve_effective_skill_level("skilled", techniques=["basic_stitching"])
        # basic_stitching floors to unskilled, self-declared skilled is higher -> stays skilled
        assert result == "skilled"

    def test_technique_floor_overrides_lower_self_declaration(self):
        # artisan under-declares as semi_skilled but handloom_weave floors to skilled
        result = resolve_effective_skill_level("semi_skilled", techniques=["handloom_weave"])
        assert result == "skilled"

    def test_multiple_techniques_take_highest_floor(self):
        result = resolve_effective_skill_level(
            "unskilled", techniques=["basic_stitching", "hand_embroidery"]
        )
        assert result == "skilled"  # hand_embroidery floors to skilled, wins over basic_stitching's unskilled

    def test_unknown_technique_does_not_crash(self):
        result = resolve_effective_skill_level("semi_skilled", techniques=["made_up_technique_xyz"])
        assert result == "semi_skilled"

    def test_no_techniques_returns_self_declared(self):
        result = resolve_effective_skill_level("unskilled", techniques=[])
        assert result == "unskilled"


# ---------- get_technique_multiplier ----------

class TestGetTechniqueMultiplier:
    def test_single_known_technique(self):
        mult = get_technique_multiplier(["handloom_weave"])
        assert mult == 1.15

    def test_unknown_technique_defaults_to_one(self):
        mult = get_technique_multiplier(["not_a_real_technique"])
        assert mult == 1.0

    def test_empty_list_defaults_to_one(self):
        mult = get_technique_multiplier([])
        assert mult == 1.0

    def test_stacking_is_capped_at_one_point_five(self):
        # handloom_weave (1.15) * natural_dye (1.1) * hand_embroidery (1.1) = 1.3915, under cap
        mult = get_technique_multiplier(["handloom_weave", "natural_dye", "hand_embroidery"])
        assert mult <= 1.5

    def test_cap_enforced_with_many_high_multipliers(self):
        techniques = ["handloom_weave"] * 10  # would stack way past 1.5 uncapped
        mult = get_technique_multiplier(techniques)
        assert mult == 1.5


# ---------- calculate_price: core fixture cases ----------

class TestCalculatePriceValid:
    def test_ka_skilled_handloom_produces_available_result(self):
        r = calculate_price(
            material_cost_inr=800,
            labour_hours=12,
            state_code="KA",
            skill_level="skilled",
            techniques=["handloom_weave"],
        )
        assert r.status == "available"
        assert r.error_code is None
        assert r.floor_amount_inr == pytest.approx(800 + 12 * 87.19, rel=1e-3)
        assert r.recommended_low_inr > r.floor_amount_inr
        assert r.recommended_high_inr > r.recommended_low_inr
        assert r.wage_source["state_code"] == "KA"

    def test_recommended_band_never_below_floor(self):
        r = calculate_price(
            material_cost_inr=100,
            labour_hours=1,
            state_code="UP",
            skill_level="unskilled",
        )
        assert r.recommended_low_inr >= r.floor_amount_inr
        assert r.recommended_high_inr >= r.floor_amount_inr

    def test_comparables_nudge_high_but_never_below_floor(self):
        r = calculate_price(
            material_cost_inr=800,
            labour_hours=12,
            state_code="KA",
            skill_level="skilled",
            comparables=[1000],  # deliberately low comparable
        )
        assert r.recommended_high_inr >= r.floor_amount_inr
        assert r.recommended_high_inr >= r.recommended_low_inr

    def test_skill_floor_applies_end_to_end(self):
        # declared unskilled but hand_embroidery floors to skilled -> should use skilled wage, not unskilled
        r = calculate_price(
            material_cost_inr=500,
            labour_hours=10,
            state_code="WB",
            skill_level="unskilled",
            techniques=["hand_embroidery"],
            zone="zone_a",
        )
        assert r.inputs["skill_level"] == "skilled"
        assert r.inputs["skill_level_self_declared"] == "unskilled"

    def test_explanation_includes_wage_source_reference(self):
        r = calculate_price(
            material_cost_inr=500,
            labour_hours=5,
            state_code="UP",
            skill_level="semi_skilled",
        )
        assert "UP Labour Dept Notification" in r.explanation


    def test_technique_multiplier_does_not_inflate_floor(self):
        # Technique multiplier must NEVER touch floor_amount_inr, only recommended_high_inr
        r_plain = calculate_price(
            material_cost_inr=500,
            labour_hours=8,
            state_code="KA",
            skill_level="skilled",
            techniques=[],
        )
        r_complex = calculate_price(
            material_cost_inr=500,
            labour_hours=8,
            state_code="KA",
            skill_level="skilled",
            techniques=["natural_dye"],  # 1.1 multiplier
        )
        assert r_plain.floor_amount_inr == r_complex.floor_amount_inr
        assert r_complex.recommended_high_inr > r_plain.recommended_high_inr


# ---------- calculate_price: unavailable / missing wage data ----------

class TestCalculatePriceUnavailable:
    def test_missing_state_returns_unavailable_not_a_crash(self):
        r = calculate_price(
            material_cost_inr=500,
            labour_hours=5,
            state_code="TN",  # no fixture data for TN
            skill_level="skilled",
        )
        assert r.status == "unavailable"
        assert r.error_code == "WAGE_RATE_UNAVAILABLE"
        assert r.floor_amount_inr is None
        assert r.recommended_low_inr is None
        assert r.recommended_high_inr is None
        assert "never guessed" in r.explanation.lower() or "withheld" in r.explanation.lower()

    def test_unavailable_never_leaks_a_number(self):
        r = calculate_price(
            material_cost_inr=999999,  # even with a huge material cost, no wage -> still no price
            labour_hours=999,
            state_code="TN",
            skill_level="skilled",
        )
        assert r.floor_amount_inr is None
        assert r.recommended_low_inr is None
        assert r.recommended_high_inr is None

    def test_up_highly_skilled_returns_unavailable_with_fallback_suggestion(self):
        r = calculate_price(
            material_cost_inr=500,
            labour_hours=8,
            state_code="UP",
            skill_level="highly_skilled",
        )
        assert r.status == "unavailable"
        assert r.error_code == "WAGE_RATE_UNAVAILABLE"
        assert r.floor_amount_inr is None
        assert r.recommended_low_inr is None
        assert r.recommended_high_inr is None
        assert r.fallback_suggestion is not None
        assert r.fallback_suggestion["used_tier"] == "skilled"
        assert r.fallback_suggestion["hourly_wage_inr"] == 65.30
        assert "coordinator must confirm" in r.fallback_suggestion["note"]


# ---------- calculate_price: malformed / invalid input ----------

class TestCalculatePriceInvalidInput:
    def test_negative_material_cost_rejected(self):
        r = calculate_price(
            material_cost_inr=-100,
            labour_hours=5,
            state_code="KA",
            skill_level="skilled",
        )
        assert r.status == "unavailable"
        assert r.error_code == "INVALID_INPUT"

    def test_zero_labour_hours_rejected(self):
        r = calculate_price(
            material_cost_inr=500,
            labour_hours=0,
            state_code="KA",
            skill_level="skilled",
        )
        assert r.error_code == "INVALID_INPUT"

    def test_negative_labour_hours_rejected(self):
        r = calculate_price(
            material_cost_inr=500,
            labour_hours=-5,
            state_code="KA",
            skill_level="skilled",
        )
        assert r.error_code == "INVALID_INPUT"


# ---------- versioning discipline ----------

class TestVersioning:
    def test_every_result_carries_calculation_version(self):
        results = [
            calculate_price(500, 5, "KA", "skilled"),
            calculate_price(500, 5, "TN", "skilled"),  # unavailable path
            calculate_price(500, 0, "KA", "skilled"),  # invalid path
        ]
        for r in results:
            assert r.calculation_version == "1.0.0"