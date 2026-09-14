# AI layer: two implementations, one directory

> **Status 2026-09-14.** Price, provenance and the config endpoint are done (2026-09-11).
> Since then: real media upload; Gemini transcription of the uploaded audio; schema-
> constrained Gemini catalogue generation; and the image studio on the uploaded photo,
> with a segmentation model in place of the Otsu mask. Each new path is behind a flag
> that defaults to legacy until teammates switch. See "What is wired now".

## What is wired now

Every capability is switchable, so both implementations stay callable and can be
compared on the same request. Flags live in `app/ai/config.py`.

| Flag | Default | Effect |
|---|---|---|
| `CRAFTLINK_PRICE_ENGINE` | `deterministic` | `deterministic` uses the tested engine; `legacy` uses `STATUTORY_WAGES` |
| `CRAFTLINK_WAGE_TABLE` | shipped empty table | `demo` loads clearly-labelled fixture rates |
| `CRAFTLINK_PROVENANCE` | `enforce` | Gate unverified claims before storage and response |
| `CRAFTLINK_ASR` | `legacy` | `gemini` or `local` transcribe the uploaded recording |
| `CRAFTLINK_CATALOGUE` | `legacy` | `gemini` generates into the taxonomy from that transcript |
| `CRAFTLINK_IMAGE` | `legacy` | `studio` grades and enhances the uploaded photo |
| `CRAFTLINK_PHOTO_CHECK` | `off` | `gemini` adds a second opinion that can only lower a photo's grade |

`GET /api/v1/ai/config` reports the live configuration, unauthenticated, so "is this
real?" is answerable from outside the process during a demo.

### Price — fixed and verified live

- `skill_level` reaches the wage lookup. Measured: 62500 / 70000 / 77500 / 87500 paise
  for unskilled → highly_skilled at 10 hours. Previously all four returned 78500.
- Comparables implemented with the asymmetry. Measured at 60h + ₹3000 materials:
  floor stays 765000 paise in all cases; an undercutting market leaves the band at
  1055700–1425200; a premium market lifts it to 1425200–1950000.
- With the shipped (empty) wage table it returns `WAGE_RATE_UNAVAILABLE` naming exactly
  what is missing, rather than substituting an estimate.
- Demo rates are disclosed **in the response**, not only in the file:
  `notification_ref: "DEMO-FIXTURE-NOT-A-REAL-NOTIFICATION"`,
  `source_url: "unsourced://demo-fixture"`, and the explanation ends "It is not a real
  price."

### Provenance — fixed and verified live

Calling the catalogue endpoint with an empty body now returns `gi_tag: null` and both
claims with `asserted_by_artisan: false`, and lists `provenance.gi_tag` and
`provenance.natural_dye` in `needs_confirmation`. Once a coordinator verifies the claim
via `POST /listings/{id}/claims/gi_tag/review`, the tag is publishable again.

The legacy behaviour — an unverified `GI-18` identifier reaching the response with
`asserted_by_artisan: true` on an endpoint nobody asserted anything to — is gone.

### Still not done

- **Evidence on real photos and recordings.** The Otsu mask is replaced by rembg
  `u2netp` (`vision/segmentation.py`); on drawn scenes with known masks it scored IoU
  0.97 and up where Otsu scored 0.18-0.71, and its tests now compare against drawn
  outlines rather than itself. Quality thresholds were re-set for JPEG photos. None of
  this has been measured on real craft photographs or artisan recordings; the consented
  evaluation set is still the thing that decides.
- **Legacy paths are still the defaults.** `gemini_client.py` targets `gemini-2.5-flash`,
  which returns 404 for new keys, so the legacy image, speech and catalogue paths return
  fixed demo content. Retiring them is a team decision, once the app uploads media.
- **Real wage notifications and GI registry entries** are still not transcribed.

---

`featai` and `backend_branch` both created `backend/app/ai/` without knowing about the
other. The merge kept both, because they are not variants of one design — they make
opposite choices about what the system is allowed to assert.

| | `service.py` + `gemini_client.py` | `vision/ pricing/ taxonomy/ linkage/` |
|---|---|---|
| Branch | `backend_branch` | `featai` |
| Wired to HTTP | yes, `routers/ai.py` | no |
| Tests | none | 71 |
| Needs a key | `GEMINI_API_KEY` (unset on every team machine today) | no |
| Reads the actual input | no | yes |

Both are useful. The routers, models, job pattern, Supabase wiring and error envelope
from `backend_branch` are real infrastructure and this document does not dispute them.
What follows is only about the AI layer's factual claims.

## Verified by running it (2026-09-11, local SQLite, no Gemini key)

Every result below came from calling the live endpoints.

**Image studio.** Called with `media_id: "nonexistent-media-id"` — no image existed.
Returned `overall: "acceptable"`, `blur: "low"`, `lighting: "acceptable"`, plus four
named transformations including "Color temperature balanced to 5500K daylight studio
benchmark" and "E-commerce square aspect ratio centering".

The `enhanced_url` is a stock Unsplash photograph with query parameters appended.
Fetching both URLs and comparing: identical 800×600 dimensions, 0.75% mean pixel
difference, channel means 87.3/99.7/117.5 → 85.3/100.0/115.8. That is the CDN's JPEG
re-encode from `q=85`. `&studio=true` and `&variant=white_backdrop` are not Unsplash
parameters and do nothing. No colour temperature shift occurred, and the output is not
square.

**Transcription.** Called with `audio_media_id: "no-such-audio"`. Returned a complete
Kannada transcript, an English translation, and `asr_confidence: 0.94`. No audio was
read. `0.94` is a literal in `gemini_client.py`.

When `GEMINI_API_KEY` *is* set, the prompt asks the model to "Generate a realistic
craft transcription" and an "ASR confidence score (0.85 to 0.99)". That is generation,
not recognition, and the confidence is drawn from a range specified in the prompt.

**Catalogue.** Returned `gi_tag: "Channapatna Toys & Dolls (GI-18)"` and, for Hindi,
`"Banaras Brocades & Sarees (GI-99)"`, with `asserted_by_artisan: true` on every claim.
No artisan asserted anything; the endpoint was called with `{}`.

**Price.** `floor = material_cost + hours × hourly_wage` computes correctly:
45000 + 6 × 7850 = 92100 paise. It refuses unknown state codes with
`WAGE_RATE_UNAVAILABLE`. Two real problems:

- `skill_level` is accepted, echoed back in `inputs`, and never used. All four levels
  return the same wage. Tested: unskilled, semi_skilled, skilled and highly_skilled all
  give `floor_amount_paise: 78500` for 10 hours in KA. The deck's claim is the state
  statutory **skilled** wage; the input that would make that true is dead code.
- There is no comparables logic, so "comparables may raise the band, never lower it" —
  one of the three defensible claims — is not implemented anywhere in this path.

## The wage rates

`STATUTORY_WAGES` in `service.py` carries six rates with notification references and
source URLs. Checked on 2026-09-11:

| State | Cited URL | HTTP |
|---|---|---|
| KA | labour.karnataka.gov.in/notifications/2025/crafts | 200 (site root, not a notification) |
| UP | uplabour.gov.in/orders/minimum-wages-handicrafts | **404** |
| RJ | rajlabour.nic.in/notifications/heritage-crafts | **does not resolve** |
| TN | tn.gov.in/handlooms/wages | **404** |
| MP | labour.mp.gov.in/wages | 200 (site root) |
| IN | labour.gov.in/national-floor-level-minimum-wage | 200 |

These rates and references cannot currently be checked against a published
notification. This is the specific risk the empty `pricing/wage_table.json` exists to
prevent: a jury member with a phone can open a cited URL in ten seconds, and a 404
behind a number printed on a slide costs more than having no number.

## Why this matters more than normal code quality

The project's pitch is not "we built an app". It is three claims about *restraint*:

1. a wage floor anchored to a published statutory rate;
2. a provenance guard that cannot state an unverified craft claim;
3. public rails, contract-tested rather than asserted.

Every finding above is a counter-example to one of those three, and each is findable in
under a minute by anyone who tries the demo rather than watching it.

The GI tags are the sharpest edge. `GI-18` and `GI-99` are presented as registry
identifiers. A GI claim attached to the wrong product is a legal exposure, not a
cosmetic bug, which is why `craft_taxonomy.json → gi_registry.entries` ships empty and
a test fails if anyone fills it.

## What reconciling looks like

Not a rewrite. `routers/ai.py` keeps its shape; the service layer changes what it calls.

1. **Image studio** → call `vision.quality.assess` and `vision.studio.enhance` on the
   real uploaded bytes. Returns actual grades, actual retake guidance, an actually
   transformed image, and refuses unusable photos. No key needed.
2. **Transcription** → call `adapters.resolve_asr(DEFAULT_ASR_PREFERENCE)`. Local
   Whisper works today with no credential; Bhashini slots in ahead of it when the ULCA
   registration lands, with no caller changing.
3. **Catalogue** → keep Gemini, but constrain generation to `listing.schema.json`,
   validate the output, and run `taxonomy.guard.enforce` before storing. Materials and
   techniques become taxonomy enums instead of free strings, so an invented technique
   fails validation rather than reaching a buyer. Drop hardcoded GI tags entirely until
   the registry is populated from ipindia.gov.in.
4. **Price** → call `pricing.engine.PricingEngine`. It honours `skill_level`, implements
   the comparables asymmetry, and refuses until a real notification is transcribed into
   `wage_table.json`.
5. **Provenance** → `asserted_by_artisan` must be set by an artisan action, never by the
   generator.

Steps 1, 2 and 5 need no credentials and no new data. Step 4 needs the wage
notifications for the pilot states, which is research, not code.

## Keep the demo honest either way

If the fixtures stay in for demo-day reliability, that is a defensible engineering
choice — but they must be labelled in the response, the way `FixtureASRAdapter` stamps
`provider: "fixture"` on everything it returns. What is not defensible is a response
that is indistinguishable from a real one. A judge who asks "is this live?" needs the
answer to be in the payload, not in whoever is speaking.

## Update 2026-09-12 — after merging origin/main

`backend_branch` and `frontend-avi` both advanced and are now merged into `featai`.
Their new work (role guards in `auth.py`, `require_role`, `/auth/me`, `/auth/refresh`,
the coordinator rework, approval and export endpoints) merged cleanly and does not
touch the AI wiring. Both suites now run together: **94 tests pass** (91 AI unit + 3
API flow).

Two things that needed resolving, recorded because neither was obvious:

**Their integration test asserted the legacy wage rate.** `test_api_flow.py` pinned
`7850` paise/hr and the reference `KLS-2025-WAGE-44`. With the deterministic engine as
the default, the test failed. It now derives the expected floor from the response's own
`inputs.hourly_wage_paise` and asserts the invariant — `floor = materials + hours x
hourly wage` — rather than an arithmetic identity built from a magic number. It will
keep passing when real notifications replace the fixtures, which the old version would
not have.

**The flags were read at import time**, so a test that had already imported the app
could not change them, and suite ordering silently decided the configuration. They are
functions now (`config.wage_table_path()` and friends). This is why running only
`app/ai/tests` let a default change break the API flow unnoticed, and why `pytest.ini`
now runs both suites.

`tests/conftest.py` points the API-flow suite at `wage_table.demo.json`, because that
suite tests the flow rather than the wage data. The refusal path stays covered by
`test_shipped_table_refuses_because_it_carries_no_rates`.

### One thing to raise with the team

The updated `FEATURES_STATUS.md` moved **AI Image Enhancer** and **Multilingual
Auto-Cataloger** from *Pending / To-Be-Implemented* into **Implemented & Verified
Features**, and now prints the wage rates as statutory fact:

> "Statutory minimum craft wage lookup — KA: `KLS-2025-WAGE-44` Rs.78.50/hr, UP:
> `UP-MINWAGE-89` Rs.68.00/hr, RJ: `RJ-MINWAGE-102` Rs.72.00/hr, ..."

Those are the references whose source URLs do not resolve (UP 404, TN 404, RJ no DNS,
checked 2026-09-11). The same document is internally inconsistent about it: its own
Notes section says "the backend runs fully offline using deterministic AI fixtures when
`GEMINI_API_KEY` is not set", which is the accurate description.

The previous revision listing these as pending was the more accurate one. Worth fixing
before the doc is shown to anyone outside the team, because a status document is
exactly the artifact a judge or reviewer reads first.
