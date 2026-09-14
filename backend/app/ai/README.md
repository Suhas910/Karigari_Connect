# CraftLink AI modules

Everything the AI track owns, importable from the FastAPI app as `app.ai.*`.

```bash
cd backend
pip install -r requirements.txt -r requirements-ai.txt
pytest                                        # 69 tests
python -m app.ai.linkage.contract_test        # ONDC conformance, printable in one screen
```

## Layout

| Path | What | Needs credentials |
|---|---|---|
| `contracts.py` | `AI_INTERFACE_CONTRACTS.md` as Python types | no |
| `taxonomy/` | Controlled vocabularies, listing JSON Schema, generation schema, provenance guard | no |
| `pricing/` | Wage-anchored price engine | no |
| `linkage/` | ONDC payload builder, schema fetcher, contract test | no |
| `vision/` | Photo quality assessor, image studio, subject segmentation (rembg; the model downloads on first use) | no |
| `adapters/` | Provider Protocols, registry, fixture replay, Gemini and local ASR, Gemini catalogue | Gemini key; Bhashini |
| `fixtures/` | Synthetic images and recorded transcripts | no |

`adapters/gemini_asr.py` reads `GEMINI_API_KEY` and calls the Gemini API when
`CRAFTLINK_ASR=gemini`. Its transcripts carry no confidence, because Gemini reports none.
A Bhashini ULCA registration is still planned, and `adapters/local_asr.py` exists so the
schedule does not depend on either.

Live Gemini check, off by default:

```bash
CRAFTLINK_LIVE_GEMINI=1 CRAFTLINK_LIVE_GEMINI_AUDIO=/path/to/recording.wav \
  pytest app/ai/tests/test_gemini_asr.py -k live
```

## The three claims, and the test that asserts each

The deck makes three defensible claims. Each is a test, not a slide:

| Claim | Test |
|---|---|
| Wage-anchored price floor | `test_low_comparables_cannot_drag_price_below_floor` |
| Provenance guard | `test_schema_rejects_invented_technique` |
| Public rails, not a marketplace | `test_on_search_payload_conforms_to_published_ondc_schema` |

Plus the one that guards the project's honesty:
`test_missing_wage_rate_refuses_rather_than_guesses`.

## ONDC

`linkage/schemas/on_search.json` is **derived, not authored**. `fetch_ondc_schema.py`
pulls ONDC's published OpenAPI bundle, extracts the `/on_search` request schema, and
stamps the upstream commit into the file. Regenerate and diff whenever ONDC publishes:

```bash
python -m app.ai.linkage.fetch_ondc_schema
```

Say "contract-tested against the published specification". Never say "mock".

`CORE_VERSION` in `beckn.py` and `EXPECTED_CORE_VERSION` in `fetch_ondc_schema.py`
must move together; `test_committed_schema_is_derived_from_ondc_and_says_so` fails if
they drift.

## What ships deliberately empty

Three files must not be filled with plausible values. Tests fail if they are:

- `pricing/wage_table.json` — every rate `null`. Transcribe from each state's official
  minimum-wage notification, with source URL and effective date.
- `taxonomy/craft_taxonomy.json` → `gi_registry.entries` — populate from the official
  GI Registry. A wrong GI claim is a legal problem.
- Real wage rates and GI entries are the two blockers on a live price demo. Neither is
  a coding task.

## Numbers in this package that are not evidence

Stated plainly so nobody quotes them as results:

- `vision/quality.py` thresholds are engineering knobs tuned to separate the synthetic
  fixtures and drawn scenes, as PNG and JPEG. They have never seen a real craft photograph.
- The segmentation scores in `vision/segmentation.py` (IoU 0.97 and up for `u2netp`) come
  from drawn scenes. They show the old colour-distance mask failing; they say nothing
  about real workshop photos.
- `LOW_CONFIDENCE_BELOW` in `adapters/local_asr.py` is a starting point, not a
  calibrated operating point.
- Whisper's `exp(avg_logprob)` confidence is a ranking heuristic, not a probability of
  correctness.
- Everything in `fixtures/` is synthetic or hand-written. None of it is artisan data.

Calibrating the first two is what the consented evaluation set in
`TEAM_BUILD_GUIDE.md` is for.

## Still open, and owned outside this package

- Money units: `AI_INTERFACE_CONTRACTS.md` has not chosen paise vs whole INR. These
  models use whole INR, matching the document's examples.
- Two transformation names (`exposure_normalization`, `resize`) are not yet in the
  contract document's example vocabulary. That is a contract change and needs the
  document's own change process.
- `adapters/bhashini.py` does not exist. It is first in `DEFAULT_ASR_PREFERENCE`
  already, and `resolve_asr` skips unregistered names, so adding it changes no caller.
