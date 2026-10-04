# To Do

The master checklist for the project. Ticked as each item finishes, with a link to its report.
Method details for every data step are in [PROCESSING_STEPS.md](PROCESSING_STEPS.md).

## 0 — Setup

- [x] Branch `ai-ml-price-extension` created and pushed
- [x] Folder layout, plan, log, experiments table
- [x] Datasets selected ([DATASETS.md](DATASETS.md))
- [x] Install OpenRefine 3.10.1
- [x] Install Orange 3.40.0
- [x] Install Orange add-ons: Text 1.16.3, Associate 1.4.0, Explain 0.6.11, Image Analytics 0.13.0, Textable 3.2.7 (extra)
- [x] Install Protégé (quarantine mark removed; see guide 00)
- [x] Claude-side ontology tools: owlready2 + rdflib in `.venv`
- [x] Download the primary dataset CSVs into `data/raw/handicraft/`
- [x] Record SHA-256 checksums of the raw files
- [x] Write the data card ([reports/00_data_card.md](reports/00_data_card.md))
- [x] Final report format: Markdown (Word conversion only at the end, if asked)

## 1 — Raw audit (State 0, no changes)

- [x] Profile the 3 CSVs (pandas, read-only) — [step_00](reports/cleaning/step_00_raw_audit.md)
- [x] Check that schemas match across files (identical 5-column header)
- [x] Check the encoding and the price format (UTF-8; price already a whole number)
- [x] Report: `reports/cleaning/step_00_raw_audit.md`
- [x] Cross-check in OpenRefine + Orange ([guide 01](guides/01_raw_audit.md)): 5/5 match, screenshots in step_00 §8
- [x] Decide D1 (primary art form), D2 (design variants), D3 (blank art forms): recommendations approved 2026-10-04

## 2 — Cleaning and processing

See [PROCESSING_STEPS.md §2](PROCESSING_STEPS.md#2--cleaning-steps) for methods and reasons.

- [x] 2.1 Combine the 3 CSVs (OpenRefine `File` column)
- [x] 2.2 Price → number; `image_file` extracted (S01)
- [x] 2.3 Exact duplicates: 0 found
- [x] 2.4 Variants: `variant_group` IDs, all rows kept (S03)
- [x] 2.5 Missing: 16 blank art-form rows removed (S02)
- [x] 2.6 Invalid values: none (min price 50)
- [x] 2.7 Text: checked clean; nothing to change
- [x] 2.8 Art forms: 3 spelling merges, `primary_artform`, 65 rare → `other` (S04)
- [ ] 2.9 Outliers: compare IQR, z-score and Isolation Forest — **after the split, training data only**
- [x] 2.10 Derived: log_price, title_len, desc_len, desc_repeat (S05). Materials / set size → later feature stages
- [x] Final cleaned dataset → `data/final/handicraft_clean.csv.gz`
- [x] Combined report: [CLEANING_REPORT](reports/cleaning/CLEANING_REPORT.md)

## 3 — Exploratory analysis

- [ ] Price distribution, skewness, kurtosis; raw vs log price
- [ ] Price by art form (boxplots, medians)
- [ ] ANOVA / Kruskal-Wallis test of art-form effect
- [ ] Correlations (Pearson, Spearman)
- [ ] Most frequent words per price band (TF-IDF)
- [ ] Report: `reports/eda/EDA_REPORT.md`

## 4 — Second dataset (Amazon Handmade)

- [ ] Schema-mapping table
- [ ] Run phases 1–3 on it
- [ ] Run as a separate experiment to test whether the pipeline transfers to new data

## 5 — Project parts (all 16 approved)

- [ ] 1 Data cleaning with audit trail (sections 1–2 above)
- [ ] 2 Statistics and EDA (section 3 above)
- [ ] 3 Craft knowledge graph: RDF triples in Protégé
- [ ] 4 Rule-based reasoning: SWRL rules + HermiT reasoner; inferred facts used as features
- [ ] 5 Market segmentation: k-Means, Hierarchical, DBSCAN; silhouette; PCA map
- [ ] 6 Material combination rules: Apriori (support, confidence, lift)
- [ ] 7 Underpricing detector: Isolation Forest / LOF
- [ ] 8 Price regression: baselines → Linear, Polynomial, Tree, RF, Gradient Boosting, kNN
- [ ] 9 Price range: quantile models (small code)
- [ ] 10 Price class classifier: Logistic, SVM, Naive Bayes, kNN; confusion matrix, ROC
- [ ] 11 Similar-items search: embeddings + nearest neighbours
- [ ] 12 LLM attribute extraction: prompt + accuracy on a hand-labelled sample
- [ ] 13 Image features (stretch goal): CNN embeddings
- [ ] 14 Explainability: SHAP, overall and per prediction
- [ ] 15 Bias audit and ethics section
- [ ] 16 Price advisor agent + demo: floor rule + model + similar items + underpricing flag (small code)

## 6 — Experiment stages (scores logged in [EXPERIMENTS.md](EXPERIMENTS.md))

- [ ] Create the frozen test set (grouped by art form) → `data/splits/`
- [ ] S0 raw, price parsed only
- [ ] S1 duplicates removed
- [ ] S2 missing values handled
- [ ] S3 outliers handled (training data only)
- [ ] S4 art forms consolidated
- [ ] S5 log(price) target
- [ ] S6 TF-IDF text features
- [ ] S7 knowledge-graph and rule features
- [ ] S8 cluster ID and material-combination features
- [ ] S9 sentence embeddings
- [ ] S10 LLM-extracted attributes
- [ ] S11 image features
- [ ] S12 hyperparameter tuning
- [ ] S13 quantile bands
- [ ] Ablation: remove one feature group at a time
- [ ] Progress chart → `figures/experiments_progress.png`

## 7 — Final report

- [ ] Data card → cleaning → EDA → knowledge graph → models → explainability and ethics → limitations
- [ ] Syllabus coverage table (Units I–V)
- [ ] Demo walkthrough
- [ ] Convert to Word — only if asked at the very end
