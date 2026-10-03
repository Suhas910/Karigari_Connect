# Project Log

Newest entries at the bottom. Each entry: what was done, the tool, why, and the outcome.

---

## 2026-10-02 — Project scoped

- **What:** Decided to build a handicraft price-prediction project for the AI&ML course,
  separate from the Karigari Connect app's own pricing.
- **Why:** The app's price is a rule (fair-wage floor × 1.15–1.6). A learned model on real market
  listings makes a proper ML project with a baseline to compare against. Synthetic data generated
  from the app's formula was rejected: a model would only relearn the formula.
- **Outcome:** Branch `ai-ml-price-extension` created from `frontend-avi`, upstream set to
  `origin/ai-ml-price-extension` (pushed later the same day).

## 2026-10-02 — Datasets selected

- **What:** Searched Kaggle and Hugging Face through their public APIs.
- **Outcome:**
  - Primary: Indian Handicraft Products (MIT licence, about 37,300 listings)
  - Secondary: Amazon Reviews 2023, Handmade Products
  - Rejected options and their reasons are in [DATASETS.md](DATASETS.md)

## 2026-10-02 — Tools chosen over code

- **What:** The work moves to visual tools: OpenRefine, Orange, Protégé.
- **Why:** Every step stays visible and reproducible by the person doing the project. The tools'
  own exports (OpenRefine history, Orange workflows) become the audit trail.
- **Outcome:** [PLAN.md](PLAN.md) written; folder structure set up so that all data, exports,
  reports and figures are committed.

## 2026-10-02 — Git handling handed to Claude for this branch

- **What:** The project owner authorised Claude to commit and push to
  `origin/ai-ml-price-extension` automatically after every stage.
- **Why:** Every step of the project must be tracked on GitHub, not only locally.
- **Outcome:** The rules are in [README.md](README.md#git-rules-for-this-branch). First commit and
  push of the project scaffold.

## 2026-10-02 — All 16 parts approved; to-do list and methods reference added

- **What:** All 16 project parts approved, including 9 (quantile price range) and 16 (advisor
  agent + demo), which need small amounts of code.
- **Outcome:**
  - [TODO.md](TODO.md): master checklist
  - [PROCESSING_STEPS.md](PROCESSING_STEPS.md): methods and recording rules for every data step
  - [PLAN.md](PLAN.md): updated

## 2026-10-02 — Report format decided

- **What:** All reports stay in Markdown. Conversion to Word happens only at the very end, and
  only if asked.
- **Why:** Markdown renders on GitHub, shows clean diffs in git history, and can be read and
  edited reliably by both of us.

## 2026-10-03 — Setup guide written

- **What:** [guides/00_setup.md](guides/00_setup.md): install steps, Orange add-ons, start-up
  checks, dataset download.
- **Versions pinned:** OpenRefine 3.10.1, Orange 3.40.0 (Apple Silicon), Protégé 5.6.9
  (from the Homebrew cask index, 2026-10-03).

## 2026-10-03 — Protégé install route changed; tool cleaning abilities documented

- **What:** `brew install --cask protege` failed: Homebrew disabled the cask on 2026-09-01
  (fails Gatekeeper).
- **Fix:** download `Protege-5.6.9-mac.zip` from the official GitHub release, then allow it
  under System Settings → Privacy & Security → Open Anyway. [Setup guide](guides/00_setup.md)
  updated.
- **Also:** added section 1b to [PROCESSING_STEPS.md](PROCESSING_STEPS.md), covering what
  OpenRefine and Orange can and can't do for cleaning (OpenRefine has no mean/median
  imputation; Orange Impute has mean/mode but no median option).

## 2026-10-03 — Protégé running; Claude-side ontology tools set up

- **Problem:** Protégé 5.6.9 wouldn't open. `spctl` showed "rejected — no usable signature": the
  app is unsigned and carried the quarantine mark.
- **Fix (run by the project owner):** `xattr -dr com.apple.quarantine "/Applications/Protégé.app"`.
  Protégé now runs.
- **Added:** a local Python environment (`ml_price/.venv`, git-ignored) with `owlready2` 0.51 and
  `rdflib` 7.6.0, so Claude can open the saved `.owl` files directly.
- **Why:** `owlready2` bundles HermiT, the same reasoner as Protégé, so Claude's checks match what
  Protégé shows. A test ontology confirmed that HermiT ran and inferred a new class membership.
- **Workflow:** you build the graph in Protégé and save it to `tool_exports/protege/`; Claude
  reasons over it, queries it, and writes the report.

## 2026-10-03 — OpenRefine and Orange confirmed installed

- **Checked:** OpenRefine 3.10.1 and Orange 3.40.0 are in `/Applications` (installed through
  Homebrew). Both pass Gatekeeper (notarised Developer ID), so no workaround is needed.
- **Not yet installed:** the Orange add-ons. Orange's bundled Python has only the core packages.

## 2026-10-03 — Orange add-ons verified

- **Checked** in Orange's bundled Python. Every add-on below is installed and loads without error:

  | Add-on | Version |
  |---|---|
  | Text | 1.16.3 |
  | Associate | 1.4.0 |
  | Explain | 0.6.11 (uses shap 0.52.0) |
  | Image Analytics | 0.13.0 |
  | Textable | 3.2.7 (extra, added by the project owner) |

- **Also available:** xgboost 2.0.3 and catboost 1.2.8, so the Gradient Boosting widget can use
  either library besides scikit-learn.

## 2026-10-03 — Raw data received; State 0 audit

- **What:** The 3 CSVs were downloaded into `data/raw/handicraft/`. Sizes match Kaggle's listing
  byte for byte, and SHA-256 checksums are saved in `data/raw/SHA256SUMS.txt`.
- **Tool:** pandas 3.0.6, read-only (run by Claude), to be cross-checked in OpenRefine and Orange
  through [guide 01](guides/01_raw_audit.md).
- **Main findings** ([step_00 report](reports/cleaning/step_00_raw_audit.md)):
  - 37,273 rows; no exact duplicates; no missing or invalid prices
  - Price is heavily skewed: mean 2,061 vs median 850, skewness 3.61, which falls to 0.51 under log
  - The IQR rule flags 3,183 rows on raw price but only 10 on log price
  - Art form is multi-label (1–6 labels, 204 distinct), and the most common labels are generic
  - 4,749 design variants (same title and price, different image), a leakage risk for the split
- **Plan impact:** steps 2.4 (variants) and 2.8 (art forms) become the main cleaning work. Three
  decisions (D1–D3) are raised for the project owner.
- **Data card:** [reports/00_data_card.md](reports/00_data_card.md)

## 2026-10-03 — Raw files stored byte-exact

- **Problem:** the global git setting `core.autocrlf=input` converted the CSVs' Windows line
  endings (CRLF) to LF when committing, so the stored files no longer matched their SHA-256
  checksums.
- **Fix:** `ml_price/.gitattributes` marks `data/raw/**` as `-text` (no conversion) and the files
  were re-added. Verified: the SHA-256 of each stored file equals `SHA256SUMS.txt`.

## Pending

- Guide 01 cross-check in OpenRefine + Orange
- Decisions D1–D3
