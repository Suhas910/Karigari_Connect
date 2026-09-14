# Feature Implementation Status

**Branch:** `backend_branch`
**Last Verified:** 2026-09-11
**Test Results:** 3/3 tests passed (`tests/test_api_flow.py`)

---

## Implemented & Verified Features

### Infrastructure & Core

- **Database** (`backend/app/database.py`): SQLAlchemy engine with primary PostgreSQL (`DATABASE_URL`) + automatic SQLite fallback (`sqlite:///./karigari.db`). Connection pooling with short-timeout verification.

- **Models** (`backend/app/models.py`): Full SQLAlchemy ORM — `User` (role-based: artisan/coordinator/admin), `ListingModel` (9-state machine: draft, processing, awaiting_confirmation, awaiting_approval, approved, export_queued, exported, rejected, failed), `MediaAssetModel`, `CatalogueModel`, `PriceCalculationModel`, `ClaimModel`, `JobModel`, `ExportRecordModel`. Backwards-compatible `Product` and `Image` models preserved.

- **Schemas** (`backend/app/schemas.py`): Complete Pydantic v2 schemas: `UserRegister`, `UserLogin`, `TokenResponse`, `UserResponse`, `CreateListingRequest/Response`, `MediaUploadRequest/Response`, `ImageStudioRequest`, `TranscriptionRequest`, `JobStatus`, `ImageJobResult`, `CatalogueDraft`, `CatalogueResult`, `PriceRequest`, `PriceResult`, `WageSourceInfo`, `ClaimReviewRequest`, `ListingDecisionRequest`, `ExportRequest`, `ExportResult`, `ApiErrorResponse`.

- **Supabase Client** (`backend/app/supabase_client.py`): Resilient Supabase helper with dummy storage fallback for offline/local runs.

- **Backend Requirements** (`backend/requirements.txt`): `fastapi`, `uvicorn[standard]`, `sqlalchemy`, `pydantic`, `python-jose`, `passlib`, `bcrypt`, `google-genai`, `pillow`, `pytest`, `httpx`, `requests`, `supabase`, `psycopg2-binary`.

- **Test Connection Script** (`backend/app/test_connection.py`): Simple script to verify DB connectivity.

---

### Authentication & Role-Based Access Control

- **Auth Utilities** (`backend/app/auth.py`): JWT creation (`create_token`) embedding `sub`, `user_id`, and `role`. Token verification (`verify_token`). `get_current_user` dependency and `require_role([...])` role guard for coordinator/admin-only endpoints.

- **Auth Router** (`backend/app/routers/auth.py`):
  - `POST /api/v1/auth/register` — Artisan, Coordinator, Admin registration with bcrypt password hashing.
  - `POST /api/v1/auth/login` — JWT token issuance.
  - `POST /api/v1/auth/refresh` — Refresh JWT for authenticated users.
  - `GET /api/v1/auth/me` — Retrieve authenticated user profile.

---

### Listings Lifecycle (9-State Machine)

- **Listings Router** (`backend/app/routers/listings.py`):
  - `POST /api/v1/listings` — Create draft listing with language preference.
  - `GET /api/v1/listings` — Role-aware list (artisans see own; coordinators/admins see all).
  - `GET /api/v1/listings/{id}` — Full listing details with nested media, catalogue, price, claims.
  - `POST /api/v1/listings/{id}/media` — Attach craft photos (`image`) and voice notes (`audio`).
  - `POST /api/v1/listings/{id}/confirm` — Artisan saves catalogue edits/confirmations; clears `needs_confirmation` fields; transitions to `awaiting_approval`.
  - `POST /api/v1/listings/{id}/submit-for-approval` — Explicit approval submission (alias: `/submit-approval`).

---

### AI Pipeline

- **Gemini Client** (`backend/app/ai/gemini_client.py`): legacy. Its model, `gemini-2.5-flash`, returns 404 for new API keys (checked 2026-09-14), so this client always returns its fixed demo content. Real Gemini calls are in `app/ai/adapters/gemini_asr.py` and `gemini_catalogue.py` (`gemini-3.5-flash`), switched on with `CRAFTLINK_ASR=gemini` and `CRAFTLINK_CATALOGUE=gemini`.

- **AI Service** (`backend/app/ai/service.py`):
  1. **AI Image Enhancer & Studio**: Quality audit (blur, lighting, framing, overall), studio enhancement variations (white backdrop, texture detail), actionable artisan guidance tips, enhanced media asset creation.
  2. **Multilingual Auto-Cataloger**: Regional speech transcription (Kannada `kn`, Hindi `hi`, English `en`) with ASR confidence scoring; dual-language SEO title/description; craft taxonomy extraction (category, materials, techniques); per-field confidence scoring; flags fields `< 0.85` into `needs_confirmation`.
  3. **Fair Wage Price Engine** (`app/ai/pricing/`): `floor = material cost + labour hours x the state's skilled hourly wage`, in integer paise. Rates come only from `pricing/wage_table.json`, which ships empty until official state notifications are transcribed with their source links. Until then pricing refuses with `WAGE_RATE_UNAVAILABLE`. `CRAFTLINK_WAGE_TABLE=demo` uses demo rates that are labelled as demo data in every response. Hours, material cost, skill level and state come from the artisan's confirmed catalogue; nothing is defaulted.

- **AI Router** (`backend/app/routers/ai.py`):
  - `POST /api/v1/listings/{id}/jobs/image-studio` — Dispatch image studio job (alias: `/ai/image-studio`).
  - `POST /api/v1/listings/{id}/jobs/transcription` — Dispatch audio transcription job (alias: `/ai/transcription`).
  - `GET /api/v1/jobs/{id}` — Poll job status (queued, processing, complete).
  - `GET /api/v1/jobs/{id}/result` — Fetch image quality audit, enhanced variations, or transcription data.
  - `POST /api/v1/listings/{id}/jobs/catalogue` — Extract structured catalogue draft with confidence scoring (alias: `/ai/catalogue`).
  - `POST /api/v1/listings/{id}/price` — Calculate fair wage protected price floor.

---

### Coordinator & Marketplace Export

- **Coordinator Router** (`backend/app/routers/coordinator.py`):
  - `POST /api/v1/listings/{id}/claims/{claim}/review` — Coordinator verification of statutory provenance claims (`handloom_weave`, `gi_tag`, `natural_dye`) with evidence notes.
  - `POST /api/v1/listings/{id}/approval` — Coordinator approve (`approved`) or reject (`rejected`) decision.
  - `POST /api/v1/listings/{id}/exports` — Construct and cryptographically sign ONDC-compliant export payload (SHA-256); persist `ExportRecordModel`; transition listing to `exported` state (alias: `/export`).

---

### API Entry Point & Cross-Cutting Concerns

- **Main App** (`backend/app/main.py`):
  - All routers mounted under `/api/v1` with root-level backwards compatibility aliases.
  - CORS middleware (`allow_origins=["*"]`).
  - Standardized `ApiError` exception handler returning `{ request_id, error: { code, message, recoverable, action } }`.
  - `RequestValidationError` handler returning `CATALOGUE_SCHEMA_INVALID`.
  - `GET /health` and `GET /api/v1/health` health check endpoints.
  - OpenAPI docs at `/docs` and `/redoc`.

- **Legacy Routers** (`backend/app/routers/products.py`, `images.py`): CRUD endpoints for legacy `Product` and `Image` models. Mounted at root for backwards compatibility.

---

### Automated Test Suite

- **Test File** (`backend/tests/test_api_flow.py`): 3 tests covering the complete end-to-end lifecycle — verified passing as of 2026-09-11.

  | Test | Status |
  |------|--------|
  | `test_health_check` | PASSED |
  | `test_full_artisan_and_coordinator_lifecycle` | PASSED |
  | `test_invalid_state_wage_rate_error` | PASSED |

  Run: `python -m pytest tests/test_api_flow.py -v`

---

## Pending / To-Be-Implemented Features

- **Asynchronous Job Processing**: Currently jobs execute synchronously within the request. True background task queue (e.g., Celery + Redis or FastAPI BackgroundTasks) for long-running Gemini inference not yet implemented.
- **Deployment Configuration**: Dockerfile and CI/CD pipeline configurations.
- **Frontend Integration**: Connect backend endpoints with the mobile app UI (React Native / Expo).
- **Performance Optimizations**: Caching layer (e.g., Redis) for frequently accessed product/listing data.
- **Comprehensive Error Recovery Testing**: Extended negative-path test coverage for all edge cases.

---

## Notes

- All implemented features are functional and verified via automated pytest (3/3 passed) and manual Postman/curl testing.
- The backend runs offline on fixtures when `GEMINI_API_KEY` is not set. Which paths call Gemini is described under Gemini Client above.
- Uploaded media is stored in `backend/media_store/`, or in the private Supabase bucket `media` when `CRAFTLINK_MEDIA_STORAGE=supabase`.
- SQLite (`karigari.db`) is used as the local development database; PostgreSQL (Neon) is configured via `DATABASE_URL` in `.env` for production.
- Pending features are prioritized according to the project roadmap defined in `backend_implementation_plan.md`.
