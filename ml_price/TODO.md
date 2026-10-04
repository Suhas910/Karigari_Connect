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
- [x] 2.9 Outliers: IQR 0 / z 12 / Isolation Forest 293 flagged on train; removal didn't help → all kept ([step_09](reports/cleaning/step_09_outliers.md))
- [x] 2.10 Derived: log_price, title_len, desc_len, desc_repeat (S05). Materials / set size → later feature stages
- [x] Final cleaned dataset → `data/final/handicraft_clean.csv.gz`
- [x] Combined report: [CLEANING_REPORT](reports/cleaning/CLEANING_REPORT.md)

## 3 — Exploratory analysis

- [x] Price distribution, skewness, kurtosis; raw vs log price (skew 3.50 → 0.49; 61% of prices end in 90)
- [x] Price by art form (boxplots, medians); Orange Box Plot cross-check
- [x] Levene, ANOVA, Kruskal-Wallis, Mann-Whitney; repeated with one row per family (ε² 0.45 → 0.35)
- [x] Correlations (Pearson, Spearman)
- [x] Most typical words per price band (TF-IDF) + chi-square technique × band (Cramér's V 0.356)
- [x] Report: [EDA_REPORT](reports/eda/EDA_REPORT.md)

## 4 — Second dataset (Amazon Handmade)

- [ ] Schema-mapping table
- [ ] Run phases 1–3 on it
- [ ] Run as a separate experiment to test whether the pipeline transfers to new data

## 5 — Project parts (all 16 approved)

- [x] 1 Data cleaning with audit trail (sections 1–2 above) ([CLEANING_REPORT](reports/cleaning/CLEANING_REPORT.md))
- [x] 2 Statistics and EDA: Kruskal-Wallis + family-level repeat, correlations, words per band ([EDA_REPORT](reports/eda/EDA_REPORT.md))
- [x] 3 Craft knowledge graph: 68 classes, 201 art forms, `.owl` for Protégé ([KG_REPORT](reports/knowledge_graph/KG_REPORT.md))
- [x] 4 Rule-based reasoning: 5 SWRL rules + HermiT, 0 disagreements with pandas; 4 SPARQL questions; features → S7
- [x] 5 Market segmentation: K-Means k=17 (silhouette 0.164), Hierarchical, DBSCAN; PCA map ([report](reports/unsupervised/UNSUPERVISED_REPORT.md))
- [x] 6 Apriori: 1,083 rules; high/low price-band rules; exposed tool-word material errors
- [x] 7 Underpricing detector: out-of-fold expected price, 6.5% flagged, cross-checked with Isolation Forest
- [x] 8 Regression comparison: 8 models, grouped-CV tuning; Ridge best (R² 0.748) [report](reports/models/PARTS_8_14_16_REPORT.md)
- [x] 9 Price range: quantile GBM 58% → conformal 83% coverage; Ridge band 77% [report](reports/models/PARTS_9_11_REPORT.md)
- [x] 10 Classifiers: 7 models, grouped-CV tuning; Gradient Boosting F1 0.810, AUC 0.925 [report](reports/models/PARTS_9_11_REPORT.md)
- [x] 11 Similar-items: FAISS index; 10-NN median R² 0.613; similarity flags uncertainty [report](reports/models/PARTS_9_11_REPORT.md)
- [x] 12 LLM extraction: 80-product gold set; keywords F1 0.755 → zero-shot 0.888 → engineered prompt 0.979 ([report](reports/llm/PART12_REPORT.md))
- [x] 13 Image features: SqueezeNet CNN embeddings in Orange (local), PCA on train; photos alone R² 0.375; S12-img **R² 0.806, MAE ₹612** ([report](reports/models/PART13_IMAGES.md))
- [x] 14 SHAP: Ridge (exact match with shap library) + tree beeswarm; per-product reasons [report](reports/models/PARTS_8_14_16_REPORT.md)
- [x] 15 Bias audit: pull to the middle; kalamkari / Kutch / ikat undervalued; ethics section [report](reports/models/PARTS_8_14_16_REPORT.md)
- [x] 16 Advisor agent + Streamlit demo: rules + Ridge range + FAISS evidence + app wage floor + cautions [report](reports/models/PARTS_8_14_16_REPORT.md)

## 6 — Experiment stages (scores logged in [EXPERIMENTS.md](EXPERIMENTS.md))

- [x] Frozen test set v2 → `data/splits/` (grouped by product family, stratified by primary art form)
- [x] S0 raw, price parsed only
- [x] S1 duplicates removed
- [x] S2 missing values handled
- [x] S3 outliers handled (training data only) — run as S6c
- [x] S4 art forms consolidated (scores fell; see EXPERIMENTS)
- [x] S5 log(price) target
- [x] `desc_repeat` checked: equals within-split count (no leak); its v2 "gain" was family memorisation
- [x] Multi-hot features for all art-form labels (S6a)
- [x] S6 TF-IDF text features (S6b: Ridge R² 0.707)
- [x] Split v3: near-duplicate families (second leak fixed)
- [x] S7 knowledge-graph and rule features (RF 0.110 → 0.527 without text)
- [x] S8 cluster ID (Ridge R² 0.714, best so far)
- [ ] Sentence embeddings (optional; TF-IDF + LLM attributes cover the text). Note: stage "S9" in EXPERIMENTS is feature scaling
- [x] S10 LLM attributes for all products (Flash-Lite, 12,875 descriptions): S10-swap Ridge R² 0.773 (best)
- [x] Image features → run as stage **S12-img** on top of the tuned S12: Ridge R² 0.806, MAE ₹612, band F1 0.821 (final best)
- [x] S12 hyperparameter tuning: TF-IDF 20k terms, min_df 2, α 1 → **Ridge R² 0.790, MAE ₹646, band F1 0.811 (final best)** ([report](reports/models/PART8B_ABLATION_TUNING.md))
- [x] S13 quantile bands (part 9)
- [x] Ablation: remove one feature group at a time (text −0.34 CV R²; every other group < 0.01, kept all)
- [x] Progress chart → `figures/experiments_progress.png` (updated each stage)

## 6b — Bias audit revision

- [x] Bias audit re-run on the final model (S12-img) and audited per product family: one bag line (453 test rows at ₹1,590) had driven the Pochampally / Kutch findings; kalamkari block printing and the pull toward the middle hold up ([revision](reports/models/PARTS_8_14_16_REPORT.md))
- [x] Advisor caution now needs ≥ 5 families of evidence (retrained)
- [x] Advisor screenshot retaken (corrected cautions + RAG explanation); headless Chrome via `?demo=1&rag=1`

## 6c — Syllabus gap parts (requested 2026-10-04)

- [x] 17 Transformer sentence embeddings (MiniLM): word-pair demo, retrieval vs LSA, stage S12-img-st (not adopted) ([report](reports/models/PART17_SENTENCE_EMBEDDINGS.md))
- [x] 18 RAG: FAISS retrieval + grounded Gemini; R² 0.34 → 0.73 with retrieval; optional in the advisor ([report](reports/llm/PART18_RAG.md))
- [ ] Optional: small Bayesian network (last cheap syllabus gap)

## 7 — Final report

- [x] Data card → cleaning → EDA → knowledge graph → models → explainability and ethics → limitations ([FINAL_REPORT](reports/final/FINAL_REPORT.md))
- [x] Syllabus coverage table (Units I–V), checked against the official syllabus text (FINAL_REPORT §12)
- [x] Demo walkthrough (FINAL_REPORT §15) + [VIVA_CHEATSHEET](reports/final/VIVA_CHEATSHEET.md)
- [ ] Convert to Word — only if asked at the very end
