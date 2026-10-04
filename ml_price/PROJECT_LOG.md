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

## 2026-10-04 — Guide 01 done: raw audit cross-checked in the tools

- **Who:** Claude, driving the apps with the project owner's permission. OpenRefine was used in
  the Claude browser pane (browsers are view-only for Claude), and Orange and Finder with full
  screen control.
- **OpenRefine:** project `handicraft_S00_raw` created through OpenRefine's import endpoint with
  the guide's settings; then 5 facets. **All 5 match** the pandas audit. No edits were made.
- **Orange:** workflow `tool_exports/orange/S00_price_distribution.ows`; raw vs log price
  histograms saved to `figures/`.
- **Notes:** Orange 3.40 names Feature Constructor "Formula". macOS blocked the save dialog from
  saving straight into the repo, so the workflow was saved to Documents and copied in with
  Finder.
- **Report:** [step_00 §8](reports/cleaning/step_00_raw_audit.md#8-cross-check-in-the-tools-2026-10-04)

## 2026-10-04 — Cleaning S01–S05 done in OpenRefine

- **Decisions:** D1–D3 as recommended (approved by the project owner).
- **How:** Claude sent 14 operations to the OpenRefine project through its API; OpenRefine
  applied and recorded them. A snapshot and the history were exported after every stage. The
  recipe is replayable from `tool_exports/openrefine/cleaning_operations_replayable.json`.
- **Result:** 37,273 → 37,257 rows (16 with no art form removed); 5 → 16 columns. Price
  statistics essentially unchanged (mean +₹0.35, median unchanged).
- **Found while cleaning:** 3 spelling variants of art-form labels merged (`shibori tye dye`, a
  zero-width space in `bhil folk art`, `tangaliyan`); 3 look-alike pairs kept apart because they
  are different crafts.
- **Check:** `primary_artform` re-derived independently in pandas → 0 mismatches.
- **Plan refinement:** the frozen test set will be **grouped by `variant_group`** (no variant
  leakage) and **stratified by `primary_artform`** (every art form in both sets), instead of
  holding out whole art forms. Reason: the art form is one of the main features, and a test set
  of unseen art forms would make that feature useless at test time.
- **Report:** [CLEANING_REPORT.md](reports/cleaning/CLEANING_REPORT.md)

## 2026-10-04 — Frozen split + first scored stages (S0–S5b)

- **Tool:** small scripts (explained in their headers), because Orange has no grouped-stratified
  split or median baseline: `scripts/make_split.py`, `scripts/evaluate_stage.py`,
  `scripts/plot_progress.py`. scikit-learn 1.9.1, matplotlib.
- **Leakage found and fixed:** the v1 split (grouped by variant group) left 71% of test rows with a
  description identical to a training row, which inflated R² to 0.788. The v2 split groups whole
  product families (shared variant group *or* shared description): 0 shared descriptions. All
  scores were re-run on v2; v1 scores are discarded.
- **Results (v2, Random Forest):** S0 R² 0.455 → S4 0.384 (worse: label combinations lost) →
  S5 0.277 (log target; MAPE improved) → S5b **0.616**, MAE ₹840.
- **Full table and reasons:** [EXPERIMENTS.md](EXPERIMENTS.md)

## 2026-10-04 — Second leak found; split v3; stages S6a–S6b

- **Checked:** `desc_repeat` equals the within-split count for every row, so it carries no
  cross-split information.
- **New stages:** S6a (all art-form labels, multi-hot) and S6b (TF-IDF of title + description);
  Ridge added as a reference model at every stage.
- **Second leak:** S6b scored R² 0.857 on v2. Check: 72% of test rows had a training row with
  ≥ 0.9 text similarity (colour variants with reworded descriptions), and copying that row's
  price alone scored R² 0.841.
- **Fix, split v3:** families also join on near-identical text (cosine ≥ 0.8; 0.7 chained into
  a 2,585-row blob). Copy-nearest drops to R² 0.255. All stages re-scored; v2 discarded.
- **Honest results (v3):** S0 best R² 0.269 (MAE ₹1,506) → S6b Ridge **0.707** (MAE ₹730,
  MAPE 42%). Price-band F1 0.534 → 0.762. Length/repeat features, which looked strong on v2,
  hurt Random Forest on unseen families.
- **Details:** [EXPERIMENTS.md](EXPERIMENTS.md)

## 2026-10-04 — Outliers (step 2.9) on training data

- IQR on log price flagged 0 rows; z-score > 3 flagged 12; Isolation Forest (1%) flagged 293.
- The extremes are genuine handspun silk Patola sarees (₹29,990–37,990), not errors.
- Removing either set from training slightly worsened Ridge (R² 0.707 → 0.705 / 0.700).
- **Decision:** keep all rows. The Isolation Forest flags are kept for part 7 (underpricing
  detector). Report: [step_09_outliers.md](reports/cleaning/step_09_outliers.md)

## 2026-10-04 — Orange cross-check of the scoring harness

- Stage S4 rebuilt in Orange (File train + File test → Linear Regression, Random Forest → Test
  and Score, "Test on test data"), driven by Claude with full screen control.
- Linear Regression R² 0.199 vs script 0.197; Random Forest 0.281 vs 0.288. The two tools
  agree, so the scripted harness can be trusted for the other stages.
- Files: `tool_exports/orange/S4_crosscheck_test_and_score.ows`, `data/splits/orange/`, two
  figures. Details in [EXPERIMENTS.md](EXPERIMENTS.md).

## Pending

- Parts 3–7: knowledge graph (Protégé), segmentation, Apriori, underpricing detector
