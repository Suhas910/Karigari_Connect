# Viva Cheat-Sheet — Handicraft Price Prediction

Short answers to likely questions. Every number matches [FINAL_REPORT](FINAL_REPORT.md).

## The 30-second pitch

> I predict the listing price of Indian handicraft products from their text, craft labels and
> photos: 37,257 products from one retailer. The key decision was an honest test split, which
> keeps near-copy products together. Without it, Random Forest looked like R² 0.86; on genuinely
> new products it scores about 0.6.
> The final model is Ridge regression on log price, with TF-IDF text, LLM-extracted materials,
> knowledge-graph rules and CNN photo features: R² 0.806, average error ₹612, up from 0.269 and
> ₹1,506. The bias audit showed the model undervalues traditional crafts like kalamkari, so in
> the price advisor the fair-wage floor always overrides the model.

## Numbers to remember

| | |
|---|---|
| Rows | 37,273 raw → 37,257 clean (16 removed) · 29,805 train / 7,452 test |
| Families (split v3) | 2,575 · near-copy threshold cosine 0.8 |
| Best model | S12-img Ridge: **R² 0.806, MAE ₹612, MAPE 34.2%, band F1 0.821** |
| Start | S0: R² 0.269, MAE ₹1,506 |
| Biggest single jump | TF-IDF text (S6b): 0.373 → 0.707 |
| LLM gold-set F1 | keywords 0.755 → zero-shot 0.888 → engineered 0.979 |
| Photos | alone R² 0.375; added +0.016 test R² (CV +0.026) |
| Best classifier | Gradient Boosting F1 0.810, AUC 0.925 |
| Price range | raw quantile 58% coverage → conformal 83% (target 80%) |
| Bias | kalamkari ×0.46–0.58, Kutch ×0.53, Pochampally ×0.68 of real price |
| EDA | skew 3.50 → 0.49 (log); Kruskal-Wallis ε² 0.45 (rows) / 0.35 (families) |

## Likely questions

**Data and cleaning**

- **Why log(price)?** Price skew is 3.5, with a long tail of expensive sarees. On raw price the
  model chases the few big errors. Log turns errors into percentages, so a ₹100 miss on a ₹300
  item counts as much as a ₹1,000 miss on a ₹3,000 item. MAPE fell from 143% to 94% at S5.
- **Why not remove outliers?** Three methods (IQR, z-score, Isolation Forest) flagged 0, 12 and
  293 rows. The flagged rows were real high-end crafts, not errors, and removing them made R² and
  MAE slightly worse.
- **Why OpenRefine?** Every operation goes into a replayable Undo/Redo history (18 operations).
  Anyone can re-apply the exact cleaning to the raw files.
- **Did you impute anything?** No. Price had no blanks. 16 rows with no art form were removed
  (0.04%) rather than guessed, because art form is used for grouping and stratifying the split.

**Evaluation and leakage**

- **What is data leakage here?** The catalogue lists the same product in many colours with
  near-identical text. A random split puts one colour in train and its twin in test, so the model
  "predicts" by memory. Copying the most similar training price alone scored R² 0.841 under the
  leaky split, and only 0.255 under v3.
- **What is GroupKFold and why use it?** Cross-validation where a whole group (product family)
  stays in one fold. It's the same rule as the test split, so the CV scores are honest. CV and test
  F1 agree within about 0.04 for every classifier.
- **Why is ablation done on CV and not test?** Choosing features by test score is tuning on the
  test set. The test set was used once per stage, never to choose.
- **Why R², MAE and MAPE together?** R² is variance explained (comparable across stages). MAE is
  the error in rupees (easy to explain). MAPE is the relative error (fair across cheap and
  expensive items).

**Models**

- **Why does Ridge beat Random Forest?** 20,000 sparse word columns and 30k rows. A linear model
  with a penalty uses all words a little. A tree splits on one column at a time and can't use most
  of them.
- **Why did plain Linear Regression collapse?** Some knowledge-graph columns are exact duplicates
  (e.g. zari as a rule and as a material). With no penalty, least squares gives them huge
  opposite weights (R² −7.5 × 10⁸). Ridge's L2 penalty keeps the weights small. Regularisation in
  one sentence.
- **Polynomial vs linear?** On the same 24 inputs, R² 0.347 → 0.577: feature interactions matter.
- **Ensembles?** Decision Tree 0.413 → Random Forest 0.608 → Gradient Boosting 0.675 (regression).
  Averaging many trees reduces variance; boosting fixes errors step by step.
- **Why is Naive Bayes weakest?** It assumes words are independent given the class. "Handwoven"
  and "handloom" appear together, so it double-counts them and over-predicts "high".
- **What is conformal calibration?** Measure how far outside its range the model falls on
  out-of-fold data, then widen every range by that amount. It turns a 58% "80% range" into a real
  83%.

**Knowledge graph and rules (Units I–II)**

- **What is forward chaining here?** Starting from known facts, apply rules until nothing new
  appears. First the class axiom gives Weaving → skilled, then IkatWeaving ⊑ Weaving passes it
  down, then R5 marks the product as skilled labour.
- **Why a class axiom for skill?** A fact on the `Weaving` individual didn't reach ikat and
  jamdani (98 vs 103 skilled). An axiom on the class is inherited by subclasses.
- **How do you know the reasoner is right?** An independent pandas version of the same rules
  agrees on all 5 classes (0 disagreements).
- **Why does the KG barely help Ridge?** The words already say "silk" and "zari". Without text it
  lifts Random Forest from 0.110 to 0.527, and it gives readable reasons to the advisor and SHAP.

**Unsupervised (Unit IV)**

- **Why K-Means and not DBSCAN for the feature?** K-Means assigns every product, including new
  ones, to its nearest centre. DBSCAN labels 5–44% as noise depending on eps.
- **Silhouette 0.164 is low, is that bad?** Product text forms overlapping groups. The segments
  still separate prices from ₹250 to ₹3,850 and improved the model (S8).
- **Support, confidence, lift?** Support is how often the itemset occurs. Confidence is
  P(right side | left side). Lift is confidence ÷ the right side's base rate. Wool + Weaving →
  high: confidence 0.995, lift 3.05 (3× the base rate of ⅓).
- **What did Apriori find that you didn't expect?** That keyword extraction was wrong: kalamkari
  → bamboo (the pen), block printing → wood (the blocks), German silver → silver. This motivated
  Part 12.

**LLM and CNN (Unit V)**

- **What did prompt engineering change?** Six explicit rules (tool vs material, German silver,
  imitation fibres) and three worked examples. German-silver accuracy went from 0/10 to 8/10;
  overall F1 0.888 → 0.979.
- **Why Flash-Lite for the full run?** The free tier allows 20 requests per day for Flash. I
  re-validated Lite on the same gold set first (F1 0.941) before using it.
- **Is sending descriptions to an LLM leakage?** No prices are sent. It's label-free feature
  extraction, like fitting a vectoriser.
- **What is transfer learning in Part 13?** SqueezeNet was trained on ImageNet. I reuse it
  unchanged and read its output as a 1,000-number description of each photo. Only PCA was fitted,
  on training photos.
- **Why SqueezeNet?** It runs locally, so photos never leave the machine. Orange's default
  (Inception) uploads them.
- **Why do photos help when text is already strong?** They show size and detail. Only 3,075 of
  37,257 titles state a size.
- **Where is RAG?** Part 11 is the retrieval step: a FAISS vector index returns similar listings
  with real prices, shown as evidence beside the prediction.

**XAI and ethics (Unit V)**

- **How do SHAP values work for Ridge?** Weight × (feature value − its training mean). Matches
  `shap.LinearExplainer` exactly.
- **Which features matter most?** Words (2.73 mean |SHAP|) ≫ KG (0.85) > segment > labels.
  "Art silk" lowers price: the model learned imitation silk is cheaper.
- **What bias did you find?** Pull toward the middle (cheap items over-priced ×1.34, ₹1,590 items
  ×0.57), and traditional crafts undervalued (kalamkari, Kutch, Pochampally).
- **So is the model unfair?** It mirrors the market it learned from. That's why it may never set
  a floor: the app's fair-wage floor (official wage × hours + materials) always overrides it, and
  the advisor warns for the affected crafts.

**Agent (Unit I)**

- **PEAS?** Performance: an 80% range, never below the floor. Environment: a new listing plus
  market knowledge. Actuators: range, verdict, cautions, evidence. Sensors: title, description,
  labels, optional cost, hours and state.
- **What type of agent?** A knowledge-based agent (KG rules + the wage-floor table) combined with
  a learned model. The rules have the final say on the floor.

## If asked "what would you do next?"

1. Put the final S12-img model into the advisor (needs Gemini + SqueezeNet at query time).
2. Re-run the bias audit on S12-img.
3. Real sale prices and labour hours from Karigari Connect artisans, which no public dataset has.
4. A stronger image-text model (e.g. CLIP) run locally.
5. The Amazon Handmade dataset, to test whether the pipeline transfers.

## Honest weak points (say them before they're asked)

- One retailer's asking prices, not sales.
- The gold set and technique map were labelled by rules, not by a craft expert.
- The advisor and bias audit use the part 8 model (0.748), not the final 0.806.
- A typical error is still a third of the price: a suggested range with evidence, not an
  automatic price.
