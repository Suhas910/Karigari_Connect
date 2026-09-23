# AGENTS.md — Karigari Connect Project Rules & Guide

> **Single Source of Truth**: See [TEAM_BUILD_GUIDE.md](file:///Users/avinav/projects/karigari-connect/TEAM_BUILD_GUIDE.md) for the complete project guide, state machine, interface contracts, and roadmap.

---

# Karigari Connect — Full Team Guide

**Project:** Voice-first, AI-powered artisan cataloging & market-linkage mobile app
**Built for:** Smart India Hackathon (SIH) PS 26090
**Also known as:** CraftLink, KarigarAI
**Repo:** `github.com/Suhas910/Karigari_Connect` (public — seeded demo creds visible on purpose for evaluators)
**Active branch:** `frontend-avi` → merges into protected `main`
**Ultimate goal:** publish-ready app, not just hackathon demo. All new work built with that bar.

---

## 1. Problem & Target User

- Target: low-literacy Indian artisans who can't easily do text-heavy listing/cataloging.
- Core idea: artisan *speaks* about their product (in local language) + uploads photos → AI turns that into a marketplace-ready listing.
- Output routes to ONDC/GeM marketplace network (India's open commerce network / government e-marketplace).
- Fair-wage protection baked in: price floor computed from official government wage notifications, not guessed.

---

## 2. Team & Roles

| Person | Role |
|---|---|
| Avinav & meera | Full-stack, frontend-led. Owns React Native app, screens, state, API integration layer. |
| Suhas & varun | Backend teammate, repo owner. FastAPI backend, supabase & neon db |
| aayush & utsab | AI teammate, Bhashini, BiRefNet, Gemini Flash |

**App roles (in-product, not team roles):**

| Role | Allowed actions |
|---|---|
| `artisan` | Create/edit own draft listings, upload media, confirm AI-extracted facts, submit for approval. |
| `coordinator` | Review assigned listings, verify/reject sensitive claims (GI tag, handloom, natural dye, etc.), approve/reject publish. |
| `admin` | Manage taxonomy, wage sources, export adapters, audit review. |

---

## 3. Tech Stack

### Frontend
- React Native + Expo (SDK 57, **development build**, not managed Expo Go)
- Zustand — state management
- React Navigation
- React Native Paper — UI components
- EAS Build — Android dev-client (verified physical device + Pixel 6 emulator) and iOS (`simulator: true`)
- `expo-audio` for audio (⚠️ **never** reintroduce `expo-av` — caused JSI ABI crash, was replaced deliberately)
- `expo-blur` + `react-native-reanimated` — used for `GlassTabBar.tsx` floating glass bottom tab bar

### Backend
- FastAPI (Python)
- pytest — 40/40 tests passing as of last audit
- Postman collection: 22-step artisan→coordinator lifecycle, auto-chaining token/ID scripts

### Auth / Database
- Supabase — auth + primary Postgres
- Neon PostgreSQL
- Avinav, suhas and varun have dashboard access to both

### AI Services
- **Bhashini ASR** — speech-to-text. **Backend-only, never called from frontend.**
- **BiRefNet** — background removal for product photos
- **Gemini Flash** — catalogue/listing generation from transcript + images (`GEMINI_API_KEY` optional — deterministic fixture fallback exists when absent)

### Dev tooling
- IDE: Antigravity (VS Code fork) — primary coding agent/IDE
- Python venv: `source venv/bin/activate`, interpreter path set in `.vscode/settings.json`
- Presentation: `pptxgenjs` for programmatic PPT generation (Canva avoided — wrong layout format for gov submission style)

---

## 4. Repo / Environment Conventions

- Feature-first folder structure under `src/`
- Mock/live backend swap goes through **one** switch point: `services/index.ts`, controlled by `USE_LIVE_BACKEND` flag
- Android emulator base URL: `http://10.0.2.2:8000/api/v1`
- Git workflow: sync `main` → merge into feature branch → commit → push → PR. **Never commit directly to `main`.**
- `.env` required keys: `SECRET_KEY`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. `GEMINI_API_KEY` optional.
- Supabase credentials: **backend `.env` only, never frontend.**

---

## 5. Hardcoded Product Constraints (non-negotiable rules)

These are rules baked into product design — violating them = bug, not style choice.

1. **No ONDC-theatre.** `network_submission` state must reflect *real* network activity only. Never fake "published"/"submitted" state. UI must say `validated`, not `submitted` or `published`, until it's actually true.
2. **Provenance claims must be gated and re-checked before export.** Claims = GI tag, natural dye, handloom weave, skill level, etc. A gate that checks only one claim type is broken — must be generic/exhaustive across all claims present on a listing.
3. **No hardcoded fake responses inside screen components.** Everything routes through `services/*` mock/live layer.
4. **`USE_LIVE_BACKEND`** is the single toggle point for mock vs real backend.
5. **Bhashini is backend-only.** Static UI text uses local i18n JSON files permanently — not routed through Bhashini.
6. **Never reintroduce `expo-av`.**
7. Wage/price floor must never be a guessed value — if no verified wage source exists for the state, return "unavailable," never a fabricated number.

---

## 6. System Architecture

```
React Native App (Expo)
        │
        │  services/* layer (single USE_LIVE_BACKEND switch)
        ▼
FastAPI Backend  ── /api/v1 ──
        │
        ├── Supabase (auth + Postgres)
        ├── Neon Postgres
        ├── Bhashini ASR (speech→text, backend-only)
        ├── BiRefNet (image background removal/enhancement)
        ├── Gemini Flash (catalogue generation from transcript+images)
        └── ONDC/GeM export adapter (validation only — network submission ≠ implemented as "theatre")
```

The AI team returns results in contract-defined shapes only. Frontend only ever consumes **backend** responses — never calls AI providers directly.

---

## 7. Interface Contract (source of truth: `AI_INTERFACE_CONTRACTS.md`)

This is locked. All screen behavior, API shapes, state transitions must match it exactly — no invented behavior.

### Common conventions
- API base path: `/api/v1`
- IDs: opaque UUID strings
- Dates: ISO 8601 UTC
- Money: integer paise in transport where possible, or explicit decimal INR — one convention, chosen before implementation, used everywhere (doc uses `amount_inr` for readability)
- Every response includes `request_id` for debugging
- Never send cloud-provider secrets, unlimited-lifetime signed URLs, or hidden prompt text to mobile app
- All mutations require an idempotency key from the app

### Listing state machine

| State | Meaning | Allowed next |
|---|---|---|
| `draft` | Capture/edit started | `processing`, `rejected` |
| `processing` | Job(s) running | `awaiting_confirmation`, `failed` |
| `awaiting_confirmation` | AI draft needs artisan correction/confirmation | `processing`, `awaiting_approval` |
| `awaiting_approval` | Artisan submitted confirmed draft | `approved`, `rejected` |
| `approved` | Coordinator approved for export | `export_queued` |
| `export_queued` | Export adapter processing | `exported`, `failed` |
| `exported` | Adapter completed recorded export action | none |
| `rejected` | Coordinator rejected + reason | `draft` after revision |
| `failed` | Recoverable technical failure | `draft` or `processing` |

### Error shape

```json
{
  "request_id": "req_123",
  "error": {
    "code": "WAGE_RATE_UNAVAILABLE",
    "message": "A verified skilled-wage rate is not available for this state.",
    "recoverable": true,
    "action": "contact_coordinator"
  }
}
```

Standard codes → frontend behavior:

| Code | Frontend behaviour |
|---|---|
| `MEDIA_QUALITY_INSUFFICIENT` | Offer retake guidance |
| `ASR_LOW_CONFIDENCE` | Ask artisan to replay/re-record/manually correct specific fields |
| `CATALOGUE_SCHEMA_INVALID` | Keep draft, show retry; backend logs details |
| `PROVENANCE_VERIFICATION_REQUIRED` | Show claim, send to coordinator review |
| `WAGE_RATE_UNAVAILABLE` | Do NOT show guessed price; show unavailable state |
| `PRICE_INPUT_REQUIRED` | Show missing field prompt, block submission; price floor cannot be guessed |
| `LISTING_STATE_INVALID` | Refresh listing status, prevent duplicate actions |
| `EXPORT_CONTRACT_INVALID` | Show export not ready; don't claim marketplace publication |
| `PROVIDER_UNAVAILABLE` | Queue/retry per adapter policy; preserve draft |

### Core listing object

```json
{
  "id": "listing_uuid",
  "artisan_id": "user_uuid",
  "state": "awaiting_confirmation",
  "preferred_language": "kn",
  "media": [
    { "id": "media_uuid", "kind": "image", "variant": "original", "status": "complete" }
  ],
  "catalogue": {},
  "price": null,
  "claims": [],
  "created_at": "2026-09-08T00:00:00Z",
  "updated_at": "2026-09-08T00:00:00Z"
}
```

### Catalogue contract

Canonical schema: `Initial Legacy Context/03_starter_kit/taxonomy/listing.schema.json`. All AI generation must validate against it.

```json
{
  "schema_version": "1.0.0",
  "catalogue": {
    "listing_id": "listing_uuid",
    "category": "handloom_saree",
    "materials": ["cotton"],
    "techniques": ["handloom_weave"],
    "title": { "en": "Cotton handloom saree", "local": "...", "local_language": "kn" },
    "description": { "en": "...", "local": "..." },
    "labour": { "hours": 12, "skill_level": "skilled", "state_code": "KA" },
    "material_cost_paise": 80000,
    "provenance": { "claims": [], "gi_tag": null },
    "source": { "transcript_id": "transcript_uuid", "asr_confidence": 0.86 }
  },
  "field_confidence": {
    "category": 0.91, "materials": 0.82, "techniques": 0.61, "labour.hours": 0.74
  },
  "needs_confirmation": ["techniques", "labour.hours"]
}
```

App **must** show `needs_confirmation` before submission. Low confidence ≠ automatically false — requires user confirmation either way.

### Endpoints (all under `/api/v1`)

**Create listing** — `POST /listings`
```json
{ "preferred_language": "kn" }
```
→ returns `draft` listing + signed-upload instructions.

**Complete image upload** — `POST /listings/{listing_id}/media`
```json
{ "kind": "image", "upload_token": "opaque_upload_token", "client_checksum": "sha256..." }
```

**Request image analysis** — `POST /listings/{listing_id}/jobs/image-studio`
```json
{ "media_id": "media_uuid" }
```

**Speech job** — `POST /listings/{listing_id}/jobs/transcription`
```json
{ "audio_media_id": "audio_uuid", "declared_language": "kn" }
```

**Catalogue generation job** — `POST /listings/{listing_id}/jobs/catalogue`
```json
{
  "transcript_id": "transcript_uuid",
  "image_media_ids": ["media_uuid"],
  "confirmed_facts": { "state_code": "KA" },
  "taxonomy_version": "0.1.0"
}
```

**Confirmation** — `POST /listings/{listing_id}/confirm`
```json
{
  "catalogue": { "...": "full schema-valid catalogue object" },
  "confirmed_fields": ["category", "materials", "techniques", "labour.hours"],
  "corrections": [
    { "field": "labour.hours", "old_value": 10, "new_value": 12, "source": "artisan" }
  ]
}
```

**Provenance review** — `POST /listings/{listing_id}/claims/{claim}/review` (coordinator only)
```json
{ "decision": "verified", "evidence_note": "Verified against cluster documentation", "reason": null }
```
Provenance guard re-runs immediately before any export, always.

**Price contract** — `POST /listings/{listing_id}/price`
```json
{
  "material_cost_paise": 80000,
  "labour_hours": 12,
  "state_code": "KA",
  "skill_level": "skilled",
  "techniques": ["handloom_weave"],
  "comparables": []
}
```

**Submit for approval** — `POST /listings/{listing_id}/submit-for-approval`

**Approval** — `POST /listings/{listing_id}/approval`
```json
{ "decision": "approved", "reason": "All required claims and listing fields reviewed" }
```

**Export** — `POST /listings/{listing_id}/exports`
```json
{ "target": "ondc_retail", "schema_version": "exact_published_schema_version" }
```
`validated` ≠ `submitted` ≠ `published`. UI must use these words precisely.

**Job status** — `GET /jobs/{job_id}`

### Contract test checklist
1. Mobile fixture response renders every required screen.
2. Invalid model output fails schema validation.
3. Low-confidence transcript causes confirmation.
4. Unverified sensitive claim cannot export.
5. Missing wage notification refuses to return a price.
6. Coordinator cannot approve another coordinator's unauthorised listing.
7. Repeated upload/mutation idempotency key doesn't create duplicate listings.
8. ONDC/Beckn payload builder validates against selected published schema.

---

## 8. Hard-Won Learnings / Gotchas

- **Contract discipline over feature claims** — `AI_INTERFACE_CONTRACTS.md` + `TEAM_BUILD_GUIDE.md` are locked. Never diverge screen behavior/API shapes/state transitions from them.
- **ONDC-theatre is a hard disqualifier** — any pattern faking network state or claim verification must be blocked at review, not just flagged.
- **Provenance gates must be exhaustive** — gate covering only one claim type is functionally broken. Real example: Kannada transcript catalogue generation produced TWO claims (`gi_tag`, `natural_dye`) simultaneously — a gate checking only one would've let the other through unverified.
- **Native dependency changes require full EAS dev-client rebuild** — cannot hot-reload into existing APK binary.
- **`ROUND_HALF_UP` is canonical** for wage derivation, not Python's default `round()` — documented in `wage_rates.json` + `pricing_service.py` docstring.
- **Skill level resolution:** `effective_skill_level = max(self_declared, technique_floor)`. Silent substitution without surfacing the override to the user is a bug, not a feature.

---

## 9. Pre-Merge Audit Log (frontend-avi → main, completed)

Two critical bugs found + fixed, verified against actual diffs:
- **Bug 1 — ONDC export theatre** (`coordinator.py`, `listings.py`, `PublishExportScreen.tsx`): `simulate_network_submission` ignored, `network_submission` strictly `"not_attempted"`, listing state goes to `export_queued`, not `exported`.
- **Bug 2 — provenance gate incomplete**: shared `get_unverified_claims` helper now gates `submit_for_approval`, `decide_approval`, and `export_listing`.

---

## 10. Recently Completed (frontend)

- `GlassTabBar.tsx` — floating glass-effect bottom tab bar (`expo-blur` + `react-native-reanimated`)
- EAS dev-client rebuild after native dependency resolution (`@emnapi/core`/`@emnapi/runtime` lock file sync fixed via clean `npm install`); APK downloaded + installed on device

---

## 11. Open Work / Roadmap (as of last sync — re-verify before acting)

- `GlassTabBar.tsx` UI feedback pending: animated highlight pill margin, spring bounce tuning
- `ProfileScreen.tsx` redesign to match approved mockup (identity card, location card, settings-row components)
- Split `CoordinatorReviewScreen.tsx` (currently 1470 lines) into tab-based sub-screens
- Add `SupportMessage` backend model
- Move "Switch Role" into Profile tab
- Make header location pill non-interactive
- Offline round prep: backend fully live-integrated, all mocked components replaced
- `ConfirmDetailsScreen.tsx` revamp needed
- **New fields needed**: Marketplace group (qty, unit, min/max order qty, COD, returnable, cancellable) & Dimensions group (L/W/H/weight product & packaging)
- Phase 2 (deferred): speak/voice button on confirm screen
- `ProfileScreen` expansion planned: Personal, Business, Bank, address/pickup days
- Expand supported states: currently KA/UP/WB only → all states & UTs (`wagerate.json` update)

---

## 12. Frontend Engineering Rules (Avinav's scope)

- Focus: UI, UX, frontend state, client-side data flow, API integration points, loading/error/empty states, AI-interaction UI, form/input handling, responsive behavior, clean component structure.
- Never redesign backend/AI architecture unless explicitly asked.
- Never change backend contracts to make frontend easier — flag mismatch instead, contract wins.
- Mock data allowed only when backend/AI endpoint isn't ready. Keep it small, local, clearly marked (`// TODO: Replace mock with backend API integration.`), structurally identical to real API shape.
- Flow: `API contract → frontend API/service layer → UI components`. Never scatter fake responses through components.
- Every backend/AI dependency: use contract-defined endpoint, keep call inside `services/*` layer, match exact request/response schema, no hardcoded backend behavior in UI, env-based URLs, leave TODOs where a teammate needs to wire something real.
- If contract and code disagree: identify mismatch, prefer contract, report it — never silently patch around it.
- Code style: simple over clever, reuse existing patterns, avoid premature optimization/unneeded abstraction/large unrelated refactors, keep temp code removable, don't touch unrelated files.

---