# Master prompt — Karigari Connect / ProfileScreen expansion (paste into Antigravity)

Grounded against the actual `frontend-avi` branch codebase (not the older `master_prompt_frontend.md`/`master_plan_02` planning docs — those describe an earlier stage; real design tokens, endpoints, and models have since diverged, listed below).

```
You are extending "Karigari Connect" (repo: Suhas910/Karigari_Connect, branch: frontend-avi). This is a live-integrated app — USE_LIVE_BACKEND = true in src/services/index.ts — so both backend (FastAPI/Postgres) and frontend (React Native/Expo/TypeScript) need changes in this pass. Do NOT treat this as frontend-mock-only work.

============================================================
GROUND TRUTH — READ BEFORE CHANGING ANYTHING
============================================================

Current ArtisanProfile fields (backend/app/models.py, backend/app/schemas.py, frontend/src/types/contracts.ts — all three currently AGREE and must keep agreeing):
- user_id, username, phone_number, role
- profile_status: 'incomplete' | 'pending_verification' | 'verified' | 'rejected'
- declared_skill_level: string | null
- declared_zone: string | null   <-- ALREADY COMPOSITE FORMAT "STATE_CODE/zone_code", e.g. "KA/zone_2". Frontend already builds this string on submit (ArtisanProfileScreen.tsx handleSubmit: `declared_zone: `${selectedState}/${selectedZone}``) and parses it back on load (`p.declared_zone.split('/')`). DO NOT change this convention. DO NOT add a separate declared_state_code field — it is redundant, the state is already encoded in declared_zone.
- id_proof_type: 'pehchan_card' | 'pm_vishwakarma' | 'none'
- id_proof_number, verified_skill_level, verified_by, verified_at

There is currently NO name, email, gender, profile image, business, or bank data anywhere in the schema. This is genuinely new.

Live endpoints already exist (frontend/src/services/api.ts, backend/app/routers/profile.py):
- GET  /profile/artisan/me        -> ArtisanProfile
- POST /profile/artisan           -> ArtisanProfileSubmitRequest -> ArtisanProfile
- GET  /profile/artisan/pending   (coordinator)
- POST /profile/artisan/{user_id}/review (coordinator)

Wage lookup (backend/app/services/pricing_service.py -> get_wage_rate(state_code, skill_level, zone)) reads backend/app/data/wage_rates.json. It returns None -> WAGE_RATE_UNAVAILABLE cleanly when no entry exists for a state/zone/skill combo. This is CORRECT, INTENDED behavior for any state without real wage data — never fill in a placeholder number to "make it work."

Existing state/zone list lives in frontend/src/store/draftStore.ts as `export const PILOT_STATES: SupportedState[]`, currently only KA/UP/WB. It is imported in 8 places across the codebase:
- src/features/profile/ArtisanProfileScreen.tsx
- src/features/profile/SkillTierEditModal.tsx
- src/features/my-listings/LiveListingsScreen.tsx
- src/features/my-listings/InReviewListingsScreen.tsx
- src/features/my-listings/MyListingsScreen.tsx
- src/features/onboarding/ArtisanExperienceScreen.tsx
- draftStore.ts itself (internal use)

Real design tokens in use RIGHT NOW (frontend/src/theme/colors.ts, spacing.ts) — use these, not any older doc's terracotta/indigo hex values:
  colors.primary = '#B84A2A'   (terracotta)
  colors.secondary = '#243354' (indigo)
  colors.background / colors.surface = '#FFFFFF'
  colors.border = '#E2DDD5'
  colors.text = '#1C1917'
  colors.textMuted = '#686460'
  colors.indigoLight = '#EEF2F9', colors.indigoBorder = '#C6D2E8'
  spacing.tapTarget = 48 (minimum tap target height)

Existing ProfileScreen component pattern to MATCH, not replace (frontend/src/features/profile/):
- ArtisanProfileScreen.tsx — page shell, loads profile, renders IdentityCard + LocationCard + settings rows, opens edit modals
- IdentityCard.tsx, LocationCard.tsx, SettingsRow.tsx — compact card/row components
- SkillTierEditModal.tsx — full-screen-ish modal with form fields, submit button, inline success/error message banner
- StatusExplanationModal.tsx, LanguagePickerModal.tsx — simpler info/picker modals

Match this exact architecture for the new sections. Do not introduce a different navigation pattern (e.g. don't build a separate stack of screens if a modal-from-card pattern is what's already there).

============================================================
HARD CONSTRAINTS — NEVER VIOLATE
============================================================
1. Never invent a wage/price number for a state without a real wage_rates.json entry. Adding a state to the picker is fine and expected; a missing wage entry must still surface WAGE_RATE_UNAVAILABLE.
2. Never store PAN, Aadhaar, or bank account number in plaintext anywhere client-visible after initial entry+submit. After a successful save, only keep a masked version in Zustand/persisted state (e.g. "XXXX XXXX 1234" for Aadhaar, "XXXXXX1234" for bank account). Never log these fields (no console.log, no crash-report breadcrumbs).
3. Never touch AI provider calls, Bhashini adapters, or catalogue/pricing generation logic. Out of scope.
4. Never add marketplace features (cart, wishlist, buyer browsing, discovery feed) — explicitly out of scope per TEAM_BUILD_GUIDE.md, still applies.
5. Keep the `PILOT_STATES` export name in draftStore.ts working for all 8 existing import sites — either keep the full definition there (fine) or move it to a new file and re-export the same name from draftStore.ts. Do not force a rename across 8 files as part of this task.
6. If GST is not registered, gst_number must not be required; if it is registered, enrollment_number must not be required. Enforce as mutually exclusive conditional validation, not just UI hiding.

============================================================
PART A — BACKEND (backend/app/)
============================================================

A1. models.py — extend the artisan profile SQLAlchemy model (same table declared_zone/declared_skill_level live on) with new nullable columns:
    # Personal
    first_name = Column(String(100), nullable=True)
    middle_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    name_as_per_aadhaar = Column(String(150), nullable=True)
    email = Column(String(150), nullable=True)
    gender = Column(String(20), nullable=True)  # 'male' | 'female' | 'other' | 'prefer_not_to_say'
    profile_image_url = Column(String(500), nullable=True)

    # Business
    business_name = Column(String(200), nullable=True)
    brand_name = Column(String(200), nullable=True)
    establishment_type = Column(String(30), nullable=True)  # individual|proprietorship|partnership|llp|pvt_ltd|public_ltd|huf|trust|society
    pan_number = Column(String(10), nullable=True)
    aadhaar_number = Column(String(12), nullable=True)  # store encrypted at rest — see A3
    gst_registered = Column(Boolean, nullable=True, default=False)
    gst_number = Column(String(15), nullable=True)
    enrollment_number = Column(String(50), nullable=True)
    business_address_line = Column(String(300), nullable=True)
    pincode = Column(String(6), nullable=True)
    district = Column(String(100), nullable=True)
    city = Column(String(100), nullable=True)
    business_state_code = Column(String(5), nullable=True)  # NOTE: separate from declared_zone by design — see A2
    ondc_std_code = Column(String(10), nullable=True)
    location_type = Column(String(20), nullable=True)  # warehouse|shop|office|home
    pickup_days = Column(JSON, nullable=True)  # e.g. ["mon","wed","fri"]

    # Bank
    account_holder_name = Column(String(150), nullable=True)
    account_number = Column(String(30), nullable=True)  # encrypted at rest — see A3
    ifsc_code = Column(String(11), nullable=True)
    bank_name = Column(String(150), nullable=True)

    Write an Alembic migration (or the project's existing migration mechanism — check for one before assuming Alembic isn't set up; if there's no migration tooling in this repo, check how the `declared_zone`/`declared_skill_level` columns were originally added and follow that exact pattern) adding these as nullable columns with no data loss.

A2. Why business_state_code is separate from declared_zone: declared_zone is the WAGE-CALCULATION zone (self-declared, drives price floor). business_state_code is the REGISTERED BUSINESS ADDRESS state (KYC/ONDC data, drives default prefill only — see Part B, price-flow behavior). They can legitimately differ (artisan registers business in a relative's name/address elsewhere but works locally). Keep them as two distinct fields, do not collapse into one.

A3. Encryption note: aadhaar_number and account_number must not sit as raw text columns if the project has ANY existing encryption-at-rest pattern (check database.py / a crypto util module first). If no such pattern exists yet, flag this back in your output as an explicit TODO comment at the column definition — do not silently ship plaintext PII columns without at least flagging it, and do not invent a crypto scheme without the team agreeing on one.

A4. schemas.py — extend ArtisanProfileSubmitRequest and ArtisanProfileResponse with the same fields (all Optional on submit, since this will be filled incrementally across 3 screens, not one giant form). Add pydantic validators:
    - pan_number: regex ^[A-Z]{5}[0-9]{4}[A-Z]$
    - ifsc_code: regex ^[A-Z]{4}0[A-Z0-9]{6}$
    - gst_number: regex ^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]{1}[A-Z\d]{1}$ (only validate if gst_registered is true)
    - pincode: exactly 6 digits
    - aadhaar_number: exactly 12 digits
    - conditional: reject if gst_registered=true and gst_number missing; reject if gst_registered=false and enrollment_number missing

A5. routers/profile.py — extend the existing POST /profile/artisan handler to accept and persist the new optional fields (partial updates — don't require all fields every call, only validate the ones present in the payload). Do not create new endpoints unless a field genuinely needs its own lifecycle (it doesn't here — one profile object, incremental saves).

A6. wage_rates.json — DO NOT add entries for new states in this pass. That requires real, dated, sourced official minimum-wage notifications per state (see TEAM_BUILD_GUIDE.md open decision #4, still unresolved). Leave a comment at the top of the ratified states list noting which states are pending real data. This is a data-sourcing task for the team, not a code task for you to fabricate.

============================================================
PART B — FRONTEND (frontend/src/)
============================================================

B1. New file: src/constants/states.ts
    Export SUPPORTED_STATES: SupportedState[] (same shape as current PILOT_STATES: {code, name, note, zones: {code, name, note}[]}).
    Cover all 28 states + 8 union territories. For any state/UT with no known wage-zone breakdown yet, use a single zone: {code: 'statewide', name: 'Statewide', note: 'Zone data pending'}.
    Use standard state codes but FLAG in a comment where more than one convention exists in common use (do not silently pick one and hide the ambiguity):
      - Chhattisgarh: CG vs ISO CT
      - Telangana: TG vs TS
      - Uttarakhand: UK vs UT
      - Odisha: OD vs older OR
    Whichever you pick, it must exactly match (case-sensitive) whatever key convention wage_rates.json eventually uses for that state — confirm with the team before this is treated as final, not just before merge.
    Then in draftStore.ts: replace the inline PILOT_STATES array with `export { SUPPORTED_STATES as PILOT_STATES } from '../constants/states';` (or equivalent re-export) so all 8 existing import sites keep working unmodified. Do not touch those 8 files.

B2. contracts.ts — extend ArtisanProfile and ArtisanProfileSubmitRequest to mirror the backend schema fields from A1/A4 exactly (same field names, same optionality). Add three light-weight derived types if useful for form components, but the wire type is the single flat ArtisanProfile — don't introduce nested PersonalDetails/BusinessDetails/BankDetails as separate network objects, keep it flat to match how the rest of this API already works (flat ArtisanProfile, not nested).

B3. New components in src/features/profile/, matching existing card/modal pattern exactly:
    - BusinessDetailsCard.tsx (mirrors LocationCard.tsx structure: icon square, title/subtitle text stack, tap to open modal)
    - BankDetailsCard.tsx (same pattern)
    - PersonalDetailsEditModal.tsx (mirrors SkillTierEditModal.tsx: form fields, inline validation messages, submit button, success/error banner)
    - BusinessDetailsEditModal.tsx (same pattern; include pincode autofill per B4; include GST toggle that conditionally shows gst_number OR enrollment_number field)
    - BankDetailsEditModal.tsx (same pattern)
    Mask aadhaar_number and account_number display in these components after a value is loaded from the server (show last 4 digits only) with a "change" affordance that clears and re-collects rather than editing a masked value in place.

B4. New file: src/services/pincodeLookup.ts
    export async function lookupPincode(pincode: string): Promise<{district: string, city: string, state: string} | null>
    Calls https://api.postalpincode.in/pincode/{pincode} directly (public, no auth/secret). Wrap in try/catch, return null on any failure or non-6-digit input, let the user still type manually on failure — never block the form on this lookup failing.

B5. ArtisanProfileScreen.tsx — add BusinessDetailsCard and BankDetailsCard below the existing LocationCard, wire their onPress to open the new modals, same loading/submitting/message state pattern already used for the skill-tier modal (don't invent a new state-management pattern, reuse what's there).

B6. Price-flow default (confirmed decision — prefill with override, not a hard lock):
    On profile load in ArtisanProfileScreen.tsx, IF profile.declared_zone is not yet set AND profile.business_state_code + a sensible default zone are available, do NOT auto-populate declared_zone from business_state_code — these remain two separate concerns (see A2). Instead: wherever the price/confirm-details flow currently reads draftStore.selectedState/selectedZone as its starting value, if those are unset for the current session, seed them from the artisan's existing declared_zone (already-existing profile-driven wage declaration) as before — no change needed there, that plumbing already exists via declared_zone. business_state_code is NOT wired into price defaults in this pass; it is pure KYC/ONDC address data. Do not conflate the two.

B7. mockApi.ts — extend mockCurrentProfile with the new fields (all null/false/empty defaults) so mock mode still renders the new screens/cards without crashing.

B8. Mark every new/changed section with a comment noting it's part of this profile-expansion change (e.g. `// PROFILE-EXPANSION:`) so it's easy to isolate in review — this is a large surface area change, isolate it for auditability.

============================================================
PART C — CONTRACT DOCS (repo root)
============================================================
Per this project's own change process ("no one changes a contract only in their own component"): update AI_INTERFACE_CONTRACTS.md's User/ArtisanProfile section and TEAM_BUILD_GUIDE.md's Core domain entities table to reflect the new fields from Part A, in the SAME change, not as an afterthought. Include the old-vs-new JSON shape for the ArtisanProfile object.

============================================================
OUTPUT FORMAT
============================================================
Full patched file contents for every file you touch or create, not diffs summarized in prose. Explain any assumption you had to make as an inline code comment at the point it applies, not as prose before/after the code. If backend has no migration tool set up (check first), say so explicitly and show the raw SQL ALTER TABLE statements instead of inventing an Alembic setup.
```
