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
  `origin/ai-ml-price-extension` (not yet pushed).

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

## Pending

- Install OpenRefine, Orange (+ add-ons), Protégé
- Download the primary dataset CSVs into `data/raw/handicraft/`
- Decide parts 9 and 16; decide the final report format
