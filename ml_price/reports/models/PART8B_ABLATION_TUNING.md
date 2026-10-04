# Part 8b — Ablation and Final Tuning (stage S12)

**Syllabus:** Unit III (cross-validation, hyperparameter tuning, model evaluation).

| | |
|---|---|
| **Script** | `scripts/part8b_ablation_tuning.py` (stage S12 also scored by `scripts/evaluate_stage.py S12`) |
| **Starting point** | S10-swap: Ridge on log price, test R² 0.773, MAE ₹681 |
| **Validation** | Grouped 5-fold CV on the 29,805 training rows (groups = product family, the same families as split v3) |
| **Outputs** | `reports/models/part8b_ablation.csv`, `part8b_tuning.csv`, `part8b_tuning.json`, `part8b_test_predictions.csv`, `part8b_run.log` |
| **Workers** | 4 (memory cap) |

## 1. Ablation: remove one feature group at a time

Feature stages S0–S10 *added* groups one by one, so each gain depended on what was already
there. An ablation does the reverse: it starts from the final set and removes one group, so each
group's contribution is measured **with everything else present**.

Ridge α = 1 (the stage-harness setting). "CV" = out-of-fold predictions on training rows, the
number to read. "Test" is shown only to confirm.

| Group removed | Columns | CV R² | CV MAE ₹ | **CV R² change** | Test R² | Test R² change |
|---|---|---|---|---|---|---|
| *(nothing: full S10-swap)* | 52 inputs | 0.738 | 691 | — | 0.773 | — |
| **TF-IDF text** | 5,000 word features | 0.395 | 1,090 | **−0.343** | 0.257 | −0.516 |
| lengths + repeat count | 4 | 0.728 | 699 | −0.010 | 0.777 | +0.004 |
| LLM materials + handloom | 19 | 0.730 | 700 | −0.008 | 0.773 | +0.000 |
| title size + set size | 5 | 0.733 | 692 | −0.005 | 0.759 | −0.014 |
| all art-form labels (multi-hot) | one per label | 0.734 | 682 | −0.004 | 0.784 | +0.011 |
| primary art form (one-hot) | 1 | 0.738 | 687 | +0.000 | 0.775 | +0.003 |
| K-Means segment | 1 | 0.739 | 689 | +0.001 | 0.763 | −0.010 |
| knowledge-graph rules (techniques, skill) | 21 | 0.742 | 686 | +0.004 | 0.767 | −0.006 |

**What it shows**

1. **The text carries the model.** Without TF-IDF, CV R² halves (0.738 → 0.395). This matches
   EDA section 5: the words name the product type (saree, keychain, bag) and material (silk, wool),
   and those drive price.
2. **Every other group changes CV R² by less than 0.01.** With the text present, they mostly
   repeat what the words already say. Art form, for example, usually appears in the title.
3. **Small changes are noise.** For the small groups, CV and test often disagree in sign. Removing
   the multi-hot labels is −0.004 on CV but +0.011 on test. So differences of ±0.01 can't be read
   as real effects.
4. **The most useful small groups are the newest ones:** lengths/repeat count, the LLM materials
   and the title size features each lower CV R² when removed.
5. **Knowledge-graph rules don't help Ridge once text is present** (+0.004 when removed). They still
   matter elsewhere: without text they lift Random Forest from 0.110 to 0.527 (stage S7-only),
   they supply readable reasons in the advisor, and they explain predictions in SHAP (part 14).

**Decision: keep all groups.** No removal improves CV by more than noise. Choosing groups by
their test score would mean tuning on the test set.

## 2. Tuning (grouped CV on training rows only)

Grid: Ridge α ∈ {0.3, 1, 3, 10} × TF-IDF vocabulary ∈ {5,000, 20,000, 50,000} terms × min_df ∈
{2, 5}. That's 24 settings × 5 folds = 120 fits, scored by MAE on log price. The TF-IDF is refitted
inside every fold, so no fold sees words from its own validation rows.

| Rank | Vocabulary | min_df | α | CV MAE (log) |
|---|---|---|---|---|
| **1** | **20,000** | **2** | **1** | **0.3263** |
| 2 | 20,000 | 5 | 1 | 0.3263 |
| 3 | 50,000 | 5 | 1 | 0.3269 |
| 4 | 50,000 | 5 | 0.3 | 0.3288 |
| 5 | 50,000 | 2 | 1 | 0.3293 |
| … | | | | |
| S10-swap setting | 5,000 | 5 | 1 | 0.3492 |

- **A larger vocabulary helps** up to 20,000 terms. At 50,000 the rare phrases start to add
  noise, so the best value is inside the grid, not at its edge. (The first run only tried 5,000 and
  20,000, and 20,000 won at the edge. The grid was widened to check, and the choice held.)
- **α = 1 stays best.** Weaker (0.3) or stronger (3, 10) penalties are worse.
- min_df 2 vs 5 makes almost no difference at 20,000 terms.

## 3. Final score: stage S12 (test set, scored once)

| Model | R² | MAE ₹ | MAPE % | Price-band F1 |
|---|---|---|---|---|
| S10-swap (before tuning) | 0.773 | 681 | 37.0 | 0.789 |
| **S12 (tuned)** | **0.790** | **646** | **35.9** | **0.811** |
| S12, Random Forest (same features) | 0.564 | 882 | 50.0 | — |
| S12, plain Linear Regression | collapses (R² ≈ −5 × 10¹¹) | | | |

Band F1 is from the harness's logistic regression. Mapping the tuned Ridge's own price predictions
to the bands gives macro-F1 0.834 (`part8b_tuning.json`). That's higher than the dedicated
classifiers in part 10 (Gradient Boosting 0.810).

**From S0 to S12:** R² 0.269 → **0.790**, MAE ₹1,506 → **₹646** (−57%), MAPE 152% → **36%**.

![progress](../../figures/experiments_progress.png)

## Notes

- **The progress chart was fixed in this step.** Since S9 it had plotted plain Linear Regression,
  whose collapse flattened every other line, and it never showed Ridge. It now shows Ridge,
  Random Forest and the art-form baseline, plus a price-band F1 panel.
- **The advisor demo (part 16) still uses the part 8 model** (Ridge α 3 on S9 features, R² 0.748).
  Retraining it on S12 would need the LLM attributes for new products at prediction time, which
  means one Gemini call per query. Left as a documented possible improvement.
