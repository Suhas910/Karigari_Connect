# Handicraft Price Prediction — Final Report

**Course:** Artificial Intelligence & Machine Learning (20-mark project component)
**Author:** Utsav · **Branch:** `ai-ml-price-extension` of `Suhas910/Karigari_Connect`, folder `ml_price/`
**Date:** 2026-10-04 · **Format:** Markdown (Word conversion only on request)

Every number here comes from a committed result file. The detailed report for each part is linked
in its section.

---

## Summary

**Task.** Estimate the market listing price of an Indian handicraft product from its title,
description, art-form labels and photo, and turn that estimate into a price **advisor** that
never undercuts a fair-wage floor.

**Data.** 37,273 product listings from one Indian handicraft retailer (Kaggle, MIT licence).
37,257 remain after cleaning, along with 37,282 product photos.

**Best model.** Ridge regression on log price, using TF-IDF text, LLM-extracted materials,
knowledge-graph rule features, size words, K-Means segment and CNN photo embeddings (stage
**S12-img**). On a frozen test set of 7,452 products from **product families never seen in
training**:

| Metric | Start (S0) | **Final (S12-img)** | Change |
|---|---|---|---|
| R² | 0.269 | **0.806** | +0.537 |
| MAE | ₹1,506 | **₹612** | −59% |
| MAPE | 152% | **34.2%** | −118 points |
| Price-band macro-F1 (low / mid / high) | 0.534 | **0.821** | +0.287 |

**Main findings**

1. **The split matters more than any model.** Near-copy listings made a random split look far
   better than reality (R² 0.86 under split v2). An honest family-grouped split (v3) was the most
   important decision in the project.
2. **Text is the main signal.** Removing the TF-IDF words drops cross-validated R² from 0.74 to
   0.39. Every other feature group adds less than 0.01, except photos (+0.026).
3. **Better inputs beat cleverer models.** An LLM reading descriptions (prompt-engineered, F1 0.98
   vs 0.76 for keywords) and a pretrained CNN reading photos each improved the model more than
   any change of algorithm.
4. **The model learns what the market charges, not what the work is worth.** Kalamkari, Kutch
   embroidery and Pochampally ikat are predicted at 46–68% of their real price. So the advisor
   treats the model as evidence and lets the Karigari Connect fair-wage floor override it.

---

## 1. Problem and data

| | |
|---|---|
| Source | [Kaggle: Indian Handicraft Products](https://www.kaggle.com/datasets/hrishikeshb80/indian-handicraft-products), MIT licence |
| Files | 3 CSVs (37,273 rows, 5 columns) + 37,282 photos (1.1 GB, 512 × 512) |
| Columns | `product_title`, `product_description`, `price`, `image_paths`, `artform` (1–6 labels) |
| Integrity | SHA-256 checksums for all raw files and photos (`data/raw/*SHA256SUMS.txt`) |
| Limits | Asking prices, not sale prices · one retailer · currency inferred as INR · **no labour hours or material costs** |

Details: [data card](../00_data_card.md), [raw audit](../cleaning/step_00_raw_audit.md).

## 2. Tools and record-keeping

| Tool | Used for |
|---|---|
| **OpenRefine 3.10** | All cleaning: 18 operations, saved as a replayable Undo/Redo recipe |
| **Orange 3.40** (+ Text, Associate, Explain, Image Analytics) | Raw-audit cross-check, model cross-check (Test and Score), EDA box plot, **CNN image embedding** |
| **Protégé** format (OWL) with owlready2 + HermiT, rdflib | Knowledge graph, SWRL rules, reasoning, SPARQL |
| **Google Gemini** (3.5 Flash / Flash-Lite) | LLM attribute extraction with prompt engineering |
| **scikit-learn, FAISS, SHAP, mlxtend, Streamlit** | Models, vector search, explanations, Apriori, demo |

Records kept for every step:

- Before / middle / after snapshots (`data/stages/S01 … S06`)
- Tool exports (`tool_exports/`)
- A dated [project log](../../PROJECT_LOG.md)
- Method notes in [PROCESSING_STEPS](../../PROCESSING_STEPS.md)
- The scoreboard in [EXPERIMENTS](../../EXPERIMENTS.md)
- One git commit per stage

## 3. Data cleaning (Part 1)

| Stage | Change | Rows |
|---|---|---|
| S00 raw | — | 37,273 |
| S01 types | Price → number; `image_file` extracted | 37,273 |
| S02 missing | 16 rows with no art form removed (0.04%) | **37,257** |
| S03 variants | `variant_group` ids for 6,911 rows in 2,010 design-variant groups (kept, not removed) | 37,257 |
| S04 art forms | 3 spelling merges; `primary_artform` = first non-generic label; 65 rare → `other` (129 classes) | 37,257 |
| S05 derived | `log_price`, title/description length, description-repeat count | 37,257 |
| S06 fix | A zero-width-space merge had silently failed (the data held the literal text `\u200b`); fixed with 4 more operations | 37,257 |

- **0 exact duplicates and 0 invalid prices.** No price was ever imputed.
- **Outliers** (training rows only):
  - flagged: IQR 0, z-score 12, Isolation Forest 293
  - removing them made R² and MAE slightly worse, and the flagged rows are real high-end crafts
  - **all kept** ([step 09](../cleaning/step_09_outliers.md))
- The price distribution barely moved (median ₹850 before and after). Cleaning fixed structure,
  not prices.

Details: [CLEANING_REPORT](../cleaning/CLEANING_REPORT.md).

## 4. The frozen test split: three versions

| Version | Grouped by | Problem found | Inflated score |
|---|---|---|---|
| v1 | design-variant group | 71% of test rows shared an exact description with training | RF R² 0.788 |
| v2 | + identical description | 72% of test rows had a ≥ 0.9-similar training row | copy-nearest-price R² 0.841 |
| **v3** | + near-identical text (TF-IDF cosine ≥ 0.8, union-find into 2,575 families) | — | copy-nearest-price falls to **0.255** |

The v3 split: 29,805 train / 7,452 test (20%), stratified by primary art form, seed 42, never
changed afterwards. All tuning uses **GroupKFold by family** on training rows. v1 and v2 scores
were discarded. Details: [EXPERIMENTS](../../EXPERIMENTS.md).

## 5. Statistics and EDA (Part 2)

Training rows only.

| Finding | Evidence |
|---|---|
| Price is strongly right-skewed | skewness 3.50, excess kurtosis 18.6; log price: 0.49 and −0.60 |
| Sellers use price points | 61.4% of prices end in 90 (₹390, ₹590, ₹990) |
| Art form changes price | Kruskal-Wallis H = 13,304, p < 10⁻³⁰⁰. Effect ε² = **0.45** on all rows, **0.35 with one row per family** (variants inflate evidence) |
| ANOVA's assumptions fail | Levene p < 10⁻³⁰⁰ (unequal spreads), so Kruskal-Wallis is the main test |
| Correlations are moderate | strongest: title length, Spearman ρ = 0.51; every link is stronger on log price |
| Words separate price bands | low: hair clip, keychain · mid: bag, sling · high: saree, kurta, dress material, silk, wool |
| Technique × band | χ² = 7,567, Cramér's V = 0.356 (weaving, tie-dye lean high; bead work, wood lean low) |

Orange Box Plot cross-check included. Details: [EDA_REPORT](../eda/EDA_REPORT.md).

## 6. Knowledge graph and rule-based reasoning (Parts 3–4)

- **Ontology:** 68 classes, 201 art forms, technique and material trees, 3,964 triples. Saved as
  `tool_exports/protege/craft_kg.owl`.
- **Skill knowledge** comes from the Karigari Connect app's technique table, written as a class
  axiom (`Weaving ⊑ requiresSkill value skilled`). Subtypes such as ikat inherit it.
- **5 SWRL rules, forward chaining:**
  - R1 textile
  - R2 handwoven silk
  - R3 zari
  - R4 metal
  - R5 skilled labour
- **Verification:** the HermiT reasoner and an independent pandas version agree on all 5 classes
  (0 disagreements).
- **4 SPARQL questions**, e.g. "which art forms use any textile technique at any depth" → 94.
- **Value:** rule-flagged handwoven silk / zari products have a median ₹4,890 (5.8× overall).
  Without text, the 37 KG features lift Random Forest R² from 0.110 to **0.527**.

Details: [KG_REPORT](../knowledge_graph/KG_REPORT.md).

## 7. Unsupervised learning (Parts 5–7)

| Part | Method | Result |
|---|---|---|
| 5 Segmentation | TF-IDF → SVD (100) → K-Means / Hierarchical / DBSCAN; PCA map | K-Means k = 17 (silhouette 0.164); segments are product types with medians ₹250–₹3,850. As a feature (S8): Ridge 0.707 → 0.714 |
| 6 Apriori | baskets of labels, materials, techniques, price band | 1,083 rules, e.g. Wool + Weaving → high (conf. 0.995, lift 3.05). **Exposed keyword errors:** kalamkari → "bamboo" (the pen), block printing → "wood" (the blocks), "German silver" → silver |
| 7 Underpricing detector | out-of-fold expected price; flag if actual < 50% | 6.5% flagged, symmetric with 7.0% over. Mostly model error on small items: a **review queue, not a verdict** |

Details: [UNSUPERVISED_REPORT](../unsupervised/UNSUPERVISED_REPORT.md).

## 8. Supervised learning: how the score improved

Ridge on the frozen test set unless noted. The full table, with Linear, Random Forest and
baselines, is in [EXPERIMENTS](../../EXPERIMENTS.md).

| Stage | Change | R² | MAE ₹ | Band F1 |
|---|---|---|---|---|
| S0 | raw art-form text only (best model: RF) | 0.269 | 1,506 | 0.534 |
| S5 | log(price) target (RF) | 0.270 | 1,304 | 0.478 |
| S6b | + TF-IDF words of title + description | **0.707** | 730 | 0.767 |
| S7 | + knowledge-graph features | 0.698 | 749 | 0.780 |
| S8 | + K-Means segment | 0.714 | 735 | 0.786 |
| S9 | + numeric features standardised | 0.752 | 691 | 0.770 |
| S10-swap | keyword materials **replaced** by LLM materials, + title size | 0.773 | 681 | 0.789 |
| S12 | tuned: TF-IDF 20k terms, min_df 2, α = 1 | 0.790 | 646 | 0.811 |
| **S12-img** | + CNN photo embeddings (128 PCA components) | **0.806** | **612** | **0.821** |

![progress](../../figures/experiments_progress.png)

**Model comparisons** (each tuned with grouped 5-fold CV, test used once)

- **Regressors (Part 8, S9 features):**
  - Ridge 0.748
  - Gradient Boosting 0.675
  - KNN 0.633
  - Random Forest 0.608
  - Polynomial (deg 2) 0.577
  - Decision Tree 0.413
  - Linear 0.347
  - median baseline −0.146

  Regularised linear models win on 5,000+ sparse word features. Ensembles beat a single tree
  (0.413 → 0.608 → 0.675).
- **Price range (Part 9):** raw quantile Gradient Boosting promises 80% coverage but delivers
  **58%** (overconfident on new families). Conformal calibration fixes it (**83%**). A simple
  Ridge ± out-of-fold error band gives 77% and is used by the advisor.
- **Classifiers (Part 10):**
  - Gradient Boosting F1 0.810, AUC 0.925
  - Random Forest 0.805
  - Logistic 0.777
  - Linear SVM 0.767
  - KNN 0.721
  - Naive Bayes 0.703
  - Decision Tree 0.669

  Errors are almost always between neighbouring bands (low ↔ high only 6 / 7,452 times).
- **Similar items (Part 11):** a FAISS vector index over the training listings. The median of the
  10 nearest neighbours' prices gives R² 0.613. Weak matches (low similarity) mean about 1.5×
  larger errors, which the advisor turns into a caution.

Details: [PARTS_8_14_16](../models/PARTS_8_14_16_REPORT.md), [PARTS_9_11](../models/PARTS_9_11_REPORT.md).

## 9. LLM, CNN, ablation and tuning (Parts 12, 13, 8b)

**Part 12, LLM attribute extraction (prompt engineering).** An 80-product gold set was built
around the keyword traps that Apriori found.

| Extractor | Precision | Recall | F1 | Exact match |
|---|---|---|---|---|
| Keywords (KG rules) | 0.638 | 0.926 | 0.755 | 0.425 |
| Gemini zero-shot | 0.798 | 1.000 | 0.888 | 0.738 |
| **Gemini engineered prompt** (6 rules + 3 examples) | 0.979 | 0.979 | **0.979** | 0.950 |
| Flash-Lite, engineered (used for the full run) | 0.967 | 0.916 | 0.941 | 0.875 |

- The zero-shot prompt marked every "German silver" product as silver (0/10). The engineered
  prompt got 8/10 right.
- All 12,875 unique descriptions were then extracted, with 0 failures; no prices are sent.
- **Replacing** the keyword materials beat adding beside them (0.768 vs 0.773).
- [PART12_REPORT](../llm/PART12_REPORT.md)

**Part 13, CNN image features (transfer learning).**

- Orange's Image Analytics ran **SqueezeNet** (pretrained on ImageNet) **locally** on all 37,282
  photos: 1,000 numbers each, nothing retrained. The default embedder (Inception) would have
  uploaded the photos, so it was not used.
- PCA was fitted on training photos only.
- **Photos alone:** R² 0.375. **Added to S12:** CV R² 0.754 → 0.780 and test **0.790 → 0.806**.
  The photos add size and detail that titles rarely state (only 3,075 of 37,257 give a size).
- [PART13_IMAGES](../models/PART13_IMAGES.md)

**Part 8b, ablation and tuning.**

- Removing one group at a time (grouped CV): TF-IDF −0.343; every other group under 0.01, with CV
  and test disagreeing in sign. All groups kept.
- Tuning over 24 settings chose TF-IDF 20k terms and α = 1. 50k was worse, so the optimum isn't at
  the edge of the grid.
- [PART8B](../models/PART8B_ABLATION_TUNING.md)

## 10. Explainability and ethics (Parts 14–15)

**SHAP (Part 14).**

- The Ridge SHAP values computed by hand match `shap.LinearExplainer` exactly (max difference
  0.0).
- Influence by group: words 2.73 ≫ KG 0.85 > segment 0.50 > labels 0.40.
- Words that raise price: saree, necklace, set, 3pc, heavy. Words that lower it: keychain,
  nosepin, fabric, **art silk** (imitation silk).
- A per-product explanation is given as % effects on the price.

**Bias audit (Part 15)**, on the part 8 Ridge:

- **Pull toward the middle:** the cheapest decile is predicted ×1.34; the ₹1,590 decile ×0.57.
- **Specific traditional crafts are undervalued:** kalamkari screen printing ×0.46, Kutch
  embroidery ×0.53, kalamkari block printing ×0.58, Pochampally ikat ×0.68. Over 90% of kalamkari
  and Kutch items are under-priced by more than 30%.
- **Ethical position:** a model trained on market prices repeats the market's undervaluation, so
  it **may never set the floor.** The advisor applies the app's fair-wage floor and warns when an
  art form is one the audit found under-priced.
- The data itself is a limitation: asking prices from one retailer, no costs or hours, generic
  labels on 6,434 rows.

## 11. The price advisor agent (Part 16)

| PEAS | |
|---|---|
| Performance | A range that holds the market price about 80% of the time; never below the fair-wage floor; cautions where the model is weak |
| Environment | A new listing; knowledge from 29,805 training listings + the app's wage tables |
| Actuators | Range, point estimate, verdict on a listed price, cautions, evidence table, explanation |
| Sensors | Title, description, art-form labels; optional listed price, material cost, hours, state, skill |

**Architecture (knowledge-based + learned):**

1. KG rules fire (R1–R5).
2. Ridge gives the estimate, with an 80% band (×0.586 – ×1.713).
3. FAISS shows the 10 most similar listings as evidence.
4. The Karigari Connect `calculate_price` gives the **fair-wage floor**, imported read-only. If no
   verified wage rate exists, the floor is "unavailable", never guessed.
5. The floor always overrides the market range.

**Example:** a Pochampally silk ikat saree listed at ₹4,500.

- Market range ₹13,840 – ₹40,430; floor ₹6,558 (40 h × ₹88.94/h skilled, Telangana + ₹3,000
  materials).
- Verdict: **below the fair-wage floor**.
- Cautions: few similar products; Pochampally ikat is under-priced by the model.

![advisor](../../figures/P16_advisor_demo.jpg)

## 12. Syllabus coverage

| Unit | Topic | Where | Evidence |
|---|---|---|---|
| I | Intelligent agents, rationality, environments, agent structure | Part 16 | PEAS table; knowledge-based + learned agent; Streamlit demo |
| I | Problem solving by search | — | **Out of scope:** pricing has no search space or goal state to explore. Stated, not forced |
| II | Knowledge representation: ontology, RDF triples, class hierarchy | Part 3 | `craft_kg.owl`, 3,964 triples |
| II | Rule-based inference, forward chaining | Part 4 | 5 SWRL rules + HermiT; chained inference (axiom → R5) |
| II | Question answering over knowledge | Part 4 | 4 SPARQL queries with `subClassOf*` paths |
| II / III | Bayes' theorem, Naive Bayes | Part 10 | Multinomial NB (F1 0.703) and why its independence assumption over-predicts "high" |
| III | Descriptive statistics, distributions, hypothesis tests, correlation | Part 2 | Skewness, Q-Q, Levene, ANOVA, Kruskal-Wallis, Mann-Whitney, χ², Pearson / Spearman |
| III | Regression: linear, polynomial, regularised, trees, ensembles, KNN | Parts 8, 8b | 8 regressors; Ridge vs Linear collapse; ensembles vs a single tree |
| III | Classification and metrics: accuracy, precision, recall, F1, ROC-AUC, confusion matrix | Part 10 | 7 classifiers |
| III | Cross-validation, hyperparameter tuning, overfitting, leakage | Parts 8, 8b, split v1–v3 | GroupKFold; grid edge check; three split versions |
| III | Uncertainty / prediction intervals | Part 9 | Quantile GBM, conformal calibration |
| IV | Distance measures | Part 5 | Euclidean vs cosine vs Manhattan agreement |
| IV | K-Means, Hierarchical, DBSCAN, silhouette | Part 5 | 3 algorithms compared |
| IV | PCA / dimensionality reduction | Parts 5, 13 | PCA map; SVD for text; PCA on CNN embeddings |
| IV | Association rules (Apriori) | Part 6 | 1,083 rules; support, confidence, lift |
| IV | Anomaly detection | Steps 2.9, Part 7 | IQR, z-score, Isolation Forest; residual-based detector |
| V | CNNs, transfer learning | Part 13 | SqueezeNet embeddings → +0.016 test R² |
| V | Embeddings, vector databases, retrieval (RAG retrieval step) | Parts 11, 16 | FAISS index; evidence shown in the advisor |
| V | LLMs and prompt engineering | Part 12 | Zero-shot vs engineered few-shot prompt, F1 0.888 → 0.979 |
| V | Explainable AI | Part 14 | SHAP (linear exact + tree) |
| V | Ethics, bias, responsible AI | Part 15 | Group audit; floor-overrides-model policy |
| — | Not covered | — | Wumpus world, resolution proofs, reinforcement learning: no environment or reward to apply them to |

## 13. Problems found and corrected

Recorded because each one changed a conclusion:

| Problem | How it was found | Fix |
|---|---|---|
| Split leakage (twice) | Test scores too good; nearest-neighbour checks | v3 family-grouped split; old scores discarded |
| Zero-width-space merge silently failed | A later re-check of the raw label text | Literal `\u200b` replaced; stages re-scored |
| Keyword materials catch tools and alloys | Apriori rules (bamboo, wood, silver) | LLM extraction with an engineered prompt (Part 12) |
| Skill not inherited by technique subtypes | Reasoner count 98 vs expected 103 | Class axiom instead of a single fact |
| Linear Regression collapse | R² −7.5 × 10⁸ after scaling | Explained (duplicate KG columns, no penalty); Ridge used |
| Raw quantile ranges overconfident | 58% coverage instead of 80% | Conformal calibration |
| Progress chart unreadable since S9 | Linear's collapse flattened every line; Ridge missing | Chart redrawn with Ridge, RF, baseline and F1 |
| Tuning optimum at the grid edge (twice) | Best value = largest value tried | Grid widened (TF-IDF 50k, PCA 256); optimum confirmed inside |

## 14. Limitations

- **Asking prices from one retailer.** The model learns this store's pricing, not the market's or
  a fair price.
- **No costs or labour hours** in the data, so the fair-wage floor can only be applied when the
  user supplies them.
- **Labels and gold set by Claude, not a domain expert.** The 80-product LLM gold set and the
  technique map were labelled against written rules.
- **The bias audit and the advisor use the part 8 Ridge (R² 0.748), not S12-img.** Using
  S12-img live would need a Gemini call and a SqueezeNet run per query.
- **A typical error is still about one third of the price** (MAPE 34%). Good enough for a
  suggested range with evidence, not for an automatic price.

## 15. Demo walkthrough

```bash
cd ml_price
```

```bash
.venv/bin/streamlit run app/streamlit_app.py
```

1. Paste a product title and description, and pick its art-form labels.
2. Optionally add the listed price, material cost, labour hours, state and skill.
3. Read the result:
   - the rules that fired
   - the market estimate and 80% range
   - the fair-wage floor and verdict
   - cautions
   - the 10 similar listings as evidence

To reproduce any stage score: `PYTHONPATH=scripts .venv/bin/python scripts/evaluate_stage.py S12-img`
(stage names in [EXPERIMENTS](../../EXPERIMENTS.md)).

## 16. File index

| What | Where |
|---|---|
| Start here | [README](../../README.md), [TODO](../../TODO.md) |
| Scoreboard | [EXPERIMENTS](../../EXPERIMENTS.md), `reports/models/experiments.csv` |
| Chronological log | [PROJECT_LOG](../../PROJECT_LOG.md) |
| Part reports | `reports/cleaning/`, `reports/eda/`, `reports/knowledge_graph/`, `reports/unsupervised/`, `reports/llm/`, `reports/models/` |
| Tool exports | `tool_exports/openrefine/`, `tool_exports/orange/`, `tool_exports/protege/` |
| Viva preparation | [VIVA_CHEATSHEET](VIVA_CHEATSHEET.md) |
