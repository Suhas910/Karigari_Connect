# Plan

## Goal

Estimate a handicraft product's market listing price from its title, description, art form (and,
as a stretch goal, its photo). Compare learned models against simple baselines, and measure how
each cleaning and feature change moves the scores.

## Project parts

| # | Part | Tool | Syllabus unit |
|---|---|---|---|
| 1 | Data cleaning with audit trail | OpenRefine | II |
| 2 | Statistics and exploratory analysis | Orange | III |
| 3 | Craft knowledge graph (RDF triples) | Protégé | II |
| 4 | Rule-based reasoning (SWRL rules + HermiT reasoner) | Protégé | I, II |
| 5 | Market segmentation (k-Means, Hierarchical, DBSCAN, PCA) | Orange | IV |
| 6 | Material combination rules (Apriori) | Orange — Associate add-on | IV |
| 7 | Underpricing detector (Isolation Forest, LOF) | Orange — Outliers | IV |
| 8 | Price regression (baselines → Linear, Polynomial, Tree, RF, Gradient Boosting, kNN) | Orange | III |
| 9 | Price range via quantile models | ⚠️ needs code — **keep or drop: undecided** | III |
| 10 | Price class classifier (Logistic, SVM, Naive Bayes, kNN) | Orange | II, III |
| 11 | Similar-items search | Orange — Document Embedding + Neighbors | V |
| 12 | LLM attribute extraction | Google AI Studio (browser) | V |
| 13 | Image features (stretch goal) | Orange — Image Analytics | V |
| 14 | Explainability (SHAP) | Orange — Explain add-on | V |
| 15 | Bias audit and ethics | Orange + written section | V |
| 16 | Price advisor agent and demo | ⚠️ needs code — **keep or drop: undecided** | I |

Out of scope, with the reason stated in the report: search algorithms, the Wumpus world,
resolution, reinforcement learning. A pricing task has no search space or reward signal for
these to act on.

## Tools

- **OpenRefine** — cleaning; its Undo/Redo history is the replayable audit trail
- **Orange Data Mining**, with add-ons:
  - Text Mining
  - Associate
  - Explain
  - Image Analytics (optional)
- **Protégé** — knowledge graph and reasoning
- **Google AI Studio** — LLM extraction
- **Kaggle website** — data download

## Experiment stages (scores re-measured after each)

Fixed evaluation harness:

- **Frozen test set**, grouped by art form. Created once, never cleaned, never changed.
- **Reference models:**
  - median baseline
  - Linear Regression
  - Random Forest
  - price class classifier
- **Metrics:**
  - R²
  - MAE (₹)
  - MAPE (%)
  - F1
  - training time

| Stage | Change |
|---|---|
| S0 | Raw data, price parsed only |
| S1 | Duplicates removed |
| S2 | Missing values handled |
| S3 | Outlier handling (3 methods compared; applied to training data only) |
| S4 | Art-form names consolidated |
| S5 | log(price) target |
| S6 | Text features (TF-IDF) |
| S7 | Knowledge-graph and rule features |
| S8 | Cluster ID and material-combination features |
| S9 | Sentence embeddings |
| S10 | LLM-extracted attributes |
| S11 | Image features (stretch goal) |
| S12 | Hyperparameter tuning (manual, every try logged) |
| S13 | Quantile bands (if part 9 is kept) |

After S13, ablation: remove one feature group at a time from the final model.

## Open decisions

- [ ] Keep or drop parts 9 and 16
- [ ] Final report format: Markdown, or PDF/Word
