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
4. **The model learns what the market charges, not what the work is worth.** It pulls prices
   toward the middle, and a few crafts (hand painting, blue pottery, kalamkari block printing,
   Bengal jamdani, Lucknowi chikankari) are under-priced across several product families. So the
   advisor treats the model as evidence and lets the Karigari Connect fair-wage floor override it.
5. **Count product families, not rows.** One bag sold in 453 prints first made Pochampally ikat and
   Kutch embroidery look undervalued. Auditing per family removed that artefact, just as grouping
   by family fixed the test split.

---

## 1. Problem and data

| | |
|---|---|
| Source | [Kaggle: Indian Handicraft Products](https://www.kaggle.com/datasets/hrishikeshb80/indian-handicraft-products), MIT licence |
| Files | 3 CSVs (37,273 rows, 5 columns) + 37,282 photos (1.1 GB, 512 × 512) |
| Columns | `product_title`, `product_description`, `price`, `image_paths`, `artform` (1–6 labels) |
| Integrity | SHA-256 checksums for all raw files and photos (`data/raw/*SHA256SUMS.txt`) |
| Limits | Asking prices, not sale prices · one retailer · currency inferred as INR · **no labour hours or material costs** |

**As a well-posed learning problem** (Mitchell): **Task** T = predict a listing's price (and its
price band) from text, labels and photo; **Performance** P = R², MAE, MAPE and band F1 on unseen
product families; **Experience** E = 29,805 priced training listings. It is supervised learning
(regression + classification), with unsupervised parts (segmentation, rules, anomalies) and a
knowledge-based layer around it.

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

## 9. LLM, CNN, transformer embeddings, RAG, ablation and tuning (Parts 12, 13, 17, 18, 8b)

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

**Part 17, transformer sentence embeddings (MiniLM, 6 attention layers, 384 numbers).**

- Learned embeddings see meaning without shared words: saree ≈ sari 0.73, handwoven ≈ handloom
  0.63, where TF-IDF scores 0. They know Indian craft terms poorly: earrings ≈ jhumka only 0.16.
- For similar-item search the in-domain LSA vectors beat MiniLM (R² 0.613 vs 0.545).
- Added to S12-img: CV R² +0.004 and MAE slightly worse, inside the noise band. **Not adopted**
  (decided on CV); scored once as stage S12-img-st for the record.
- [PART17](../models/PART17_SENTENCE_EMBEDDINGS.md)

**Part 18, retrieval-augmented generation.** FAISS retrieves 10 similar training listings; Gemini
estimates the price using only that evidence, cites the listings it relied on and labels the match
quality. 40 test products, one per family:

| Method | R² | Median error |
|---|---|---|
| LLM without retrieval | 0.34 | 41.7% |
| **RAG** | **0.73** | **24.6%** |
| Neighbour median, no LLM | 0.73 | 31.4% |
| Ridge S12-img | 0.85 | 26.7% |

- Retrieval more than doubles the LLM's R².
- Citations are valid in 100% of answers, and every estimate lies inside the evidence's price span.
- The model's own "good / partial / poor" label predicts its error (median 18% / 34% / 178%).
- Its ranges are overconfident (52.5% coverage).
- Added to the advisor as an optional explanation.
- [PART18](../llm/PART18_RAG.md)

## 10. Explainability and ethics (Parts 14–15)

**SHAP (Part 14).**

- The Ridge SHAP values computed by hand match `shap.LinearExplainer` exactly (max difference
  0.0).
- Influence by group: words 2.73 ≫ KG 0.85 > segment 0.50 > labels 0.40.
- Words that raise price: saree, necklace, set, 3pc, heavy. Words that lower it: keychain,
  nosepin, fabric, **art silk** (imitation silk).
- A per-product explanation is given as % effects on the price.

**Bias audit (Part 15)**, on the part 8 Ridge and on the final S12-img model. Ratio = predicted ÷
actual price, 1.0 = fair.

- **First version (per product):** kalamkari screen printing ×0.46, Kutch embroidery ×0.53,
  Pochampally ikat ×0.68 looked systematically undervalued.
- **Revision (per product family):** every one of those art forms had a median test price of
  exactly ₹1,590. 453 of the 524 test products at ₹1,590 are **one product line**, "Handcrafted
  Fabric Jhola Bag", in hundreds of prints labelled with different crafts. Counted once per family:
  - Pochampally ikat ×1.04 (25 families) and Kutch embroidery ×1.10: **no craft-wide bias**
  - kalamkari screen printing: only 2 families, one of them the bag; no conclusion possible
  - **kalamkari block printing ×0.74** (final model) holds up, with hand painting ×0.73, blue
    pottery ×0.74, Bengal jamdani ×0.80 and Lucknowi chikankari ×0.83
- **Pull toward the middle, confirmed per family:** cheapest fifth of families ×1.31 (part 8) →
  **×1.13 (final)**; dearest fifth ×0.86 → ×0.89. Across all 510 test families the final model's
  median ratio is 1.017, so the bias is at the price extremes and in a few crafts, not general.
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
- Cautions: few similar products. (The screenshot below also shows "Pochampally ikat is
  under-priced". That caution came from the per-product audit and was removed by the
  family-level revision: the advisor now warns only for crafts with at least 5 families of
  evidence, e.g. kalamkari block printing.)

![advisor](../../figures/P16_advisor_demo.jpg)

## 12. Syllabus coverage

Checked against the official syllabus text. ✅ covered with evidence · ◐ touched, not developed ·
❌ not covered (reason given).

| Unit | Syllabus topic | | Where / evidence |
|---|---|---|---|
| **I** | What is AI; intelligent agents, environments, rationality, agent structure | ✅ | Part 16: PEAS table; knowledge-based + learned agent |
| I | Problem solving by search (uninformed, informed, heuristics) | ❌ | Pricing has no state space or goal to search. Hyperparameter grid search is exhaustive search over settings, but isn't claimed as this topic |
| I | Logical agents, knowledge-based agents | ✅ | The advisor's knowledge layer (KG rules, wage-floor tables) decides cautions and the floor |
| I | Wumpus world; propositional logic reasoning patterns | ❌ | Not applicable to the task |
| I | First-order logic, knowledge engineering in FOL | ◐ | SWRL rules are first-order Horn clauses over variables (`?p ?a ?t`); building the ontology is knowledge engineering (Parts 3–4) |
| **II** | Knowledge graphs, ontologies, RDF triples, entities and relationships | ✅ | Part 3: 68 classes, 201 art forms, 3,964 triples (`craft_kg.owl`) |
| II | Ontology reasoning, rule-based inference, semantic relationships | ✅ | Part 4: HermiT + 5 SWRL rules; class axiom inheritance; 0 disagreements with pandas |
| II | Applications in question answering and intelligent agents | ✅ | 4 SPARQL questions; KG rules inside the advisor agent |
| II | Inference in FOL: unification and lifting, **forward chaining** | ✅ / ◐ | Forward chaining: axiom → inherited skill → R5 fires. Unification happens inside the reasoner when rule variables bind to individuals (not implemented by hand) |
| II | Backward chaining, resolution | ❌ | Not used: the reasoner materialises all facts forward |
| II | Uncertainty, conditional probability, Bayes' theorem, **Naive Bayes** | ✅ | Part 10: Multinomial NB (F1 0.703) and why its independence assumption over-counts correlated words; Part 9 prediction intervals as quantified uncertainty |
| II | Bayesian networks | ❌ | Not built |
| II | Intro to ML: terminology, key tasks, **well-posed learning problems**, types of ML | ✅ | §1 (T, P, E); supervised (Parts 8–10), unsupervised (5–7), knowledge-based (3–4) |
| **III** | Classification: Logistic Regression, SVM, Naive Bayes, KNN | ✅ | Part 10: all four, plus trees and ensembles |
| III | Regression: Linear, Polynomial | ✅ | Part 8: Linear 0.347 vs Polynomial 0.577 on the same inputs; Ridge (regularised) 0.748 |
| III | Decision Trees, Random Forest, Gradient Boosting | ✅ | Parts 8 and 10: tree 0.413 → RF 0.608 → GB 0.675 (regression) |
| III | Cross-validation, hyperparameter tuning | ✅ | GroupKFold everywhere; Parts 8, 8b (grid-edge check), 10, 13 |
| III | Accuracy, precision, recall, F1, ROC-AUC, confusion matrix, R² | ✅ | Part 10 table and confusion matrices; R² / MAE / MAPE in every stage |
| **IV** | Unsupervised learning: need, characteristics, vs supervised | ✅ | Part 5 groups products from text alone, with no target; Part 6 mines rules with no chosen target (price band is just one more item in the basket); contrast with Parts 8–10 |
| IV | Euclidean, Manhattan, cosine; intra- and inter-cluster distance | ✅ | Part 5: metric agreement table; intra 0.690 vs inter-centroid 0.885 |
| IV | K-Means, Hierarchical, DBSCAN | ✅ | Part 5: all three compared (silhouette, noise share) |
| IV | Principal Component Analysis | ✅ | Part 5 map; Part 13 PCA on CNN embeddings (fitted on train) |
| IV | Apriori; support, confidence, lift | ✅ | Part 6: 1,083 rules |
| IV | Anomaly detection: concepts, need, approaches | ✅ | Step 2.9 (IQR, z-score, Isolation Forest) and Part 7 (model-residual detector) |
| **V** | Neural networks, **CNNs for computer vision** | ✅ | Part 13: SqueezeNet embeddings of 37,282 photos (transfer learning), +0.016 test R² |
| V | Transformers; attention; transformer architecture | ✅ | Part 17: MiniLM (6 self-attention layers) encodes all texts, with the mechanism explained; Gemini (transformer LLM) in Parts 12, 18 |
| V | Word embeddings | ✅ | Part 17: learned embeddings vs TF-IDF on word pairs (saree ≈ sari 0.73 vs 0); count-based LSA vectors in Parts 5, 11 for contrast |
| V | Large language models, **prompt engineering** | ✅ | Part 12: zero-shot vs engineered few-shot, F1 0.888 → 0.979 on a gold set |
| V | Retrieval-augmented generation | ✅ | Part 18: FAISS retrieval + grounded Gemini generation; R² 0.34 → 0.73 with retrieval; citation and grounding checks; optional in the advisor |
| V | **Vector databases (FAISS / Chroma)** | ✅ | Part 11: FAISS `IndexFlatIP` over 29,805 listings |
| V | Reinforcement learning (MDP, Q-learning, exploration) | ❌ | No sequential decisions or rewards in a one-shot pricing task |
| V | Explainable AI | ✅ | Part 14: SHAP (exact linear check + tree explainer) |
| V | Ethics, bias, responsible AI | ✅ | Part 15: family-level bias audit; fair-wage floor overrides the model |
| — | Supporting work (not a named syllabus topic) | — | Part 2 statistics (Kruskal-Wallis, χ², correlation); leakage-aware splitting |

**Remaining gap that could be closed cheaply**, if needed: a small hand-built **Bayesian network**
(e.g. technique → material → price band) with probabilities from the training data.

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
| Bias audit dominated by one product line | All "undervalued" crafts had a median test price of exactly ₹1,590 | Audit per product family; advisor caution needs ≥ 5 families |
| PyTorch + FAISS crash (exit 139) | Part 17 died after encoding | The two OpenMP runtimes clash on macOS; encode and evaluate run as separate processes |
| Tuning optimum at the grid edge (twice) | Best value = largest value tried | Grid widened (TF-IDF 50k, PCA 256); optimum confirmed inside |

## 14. Limitations

- **Asking prices from one retailer.** The model learns this store's pricing, not the market's or
  a fair price.
- **No costs or labour hours** in the data, so the fair-wage floor can only be applied when the
  user supplies them.
- **Labels and gold set by Claude, not a domain expert.** The 80-product LLM gold set and the
  technique map were labelled against written rules.
- **The advisor uses the part 8 Ridge (R² 0.748), not S12-img.** Using S12-img live would need a
  Gemini call and a SqueezeNet run per query. The bias audit was run on both models.
- **Few families per craft.** Family-level bias results rest on 5–25 families per art form, so
  they are indications, not proofs.
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
| Python environment | [requirements.txt](../../requirements.txt) (pinned versions) |
