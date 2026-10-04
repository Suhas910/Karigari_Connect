# Experiments

All scores are on the **frozen test set** (7,514 rows), in rupees on the original price.
Source: `reports/models/experiments.csv`, written by `scripts/evaluate_stage.py`. The split is from
`scripts/make_split.py`.

## The frozen split (v2, 2026-10-04)

| | Value |
|---|---|
| Train / test rows | 29,743 / 7,514 (20.2% test) |
| Grouping | **Product family**: rows sharing a `variant_group` *or* an identical description are joined, and a family goes entirely to one side. 12,304 families; the largest has 392 rows |
| Stratified by | `primary_artform`. 3 small art forms ended up train-only and 1 test-only (grouping takes priority) |
| Shared variant groups / descriptions across sides | 0 / 0 |
| Median price, train / test | ₹850 / ₹890 |

**Why v2?** The v1 split grouped by `variant_group` only. A check found that **71% of test rows
had a description identical to a training row**, and 83% of those had the same price, so the
model was recognising products it had effectively already seen. Under v1, Random Forest at S5b
scored R² 0.788, but only 0.600 on test rows with unseen descriptions. v1 was discarded.

## Regression — target: price

| Stage | Change | Train rows | Features | Median baseline R² | Median per art form R² | Linear Reg. R² | Random Forest R² | RF MAE (₹) | RF MAPE (%) |
|---|---|---|---|---|---|---|---|---|---|
| S0 | Raw; artform list text as one category | 29,759 | 1 | −0.193 | 0.356 | 0.457 | 0.455 | 1,259 | 102.1 |
| S1 | Types fixed | 29,759 | 1 | −0.193 | 0.356 | 0.457 | 0.455 | 1,259 | 102.1 |
| S2 | 16 rows removed | 29,743 | 1 | −0.193 | 0.356 | 0.457 | 0.455 | 1,259 | 102.2 |
| S4 | Primary art form + label count | 29,743 | 2 | −0.193 | 0.193 | 0.320 | 0.384 | 1,380 | 113.9 |
| S5 | log(price) target | 29,743 | 2 | −0.193 | 0.193 | 0.207 | 0.277 | 1,342 | 77.2 |
| S5b | + title length, description length, description-repeat count | 29,743 | 5 | −0.193 | 0.193 | 0.300 | **0.616** | **840** | **41.8** |

Median-baseline MAE is ₹1,741 at every stage; the baseline doesn't change.
(S3 only added the variant IDs used by the split, so it has no row of its own.)

## Classification — target: price band (low / mid / high, training-set tertiles)

| Stage | Logistic Regression macro-F1 |
|---|---|
| S0–S2 | 0.604 |
| S4–S5 | 0.543 |
| S5b | 0.606 |

## Progress chart

![](figures/experiments_progress.png)

## What the stages show

1. **S1 and S2 change nothing.** Fixing types and removing 16 rows (0.04%) can't move the
   scores. Expected, and reported anyway.
2. **S4 made scores worse** (Random Forest R² 0.455 → 0.384). The raw `artform` text is the whole
   *combination* of labels (733 distinct lists), and the combination carries price information
   (e.g. `ajrakh block printing | natural dyed`). Keeping only one primary label threw that away.
   **Fix planned for S6/S7:** encode all labels as multi-hot features, not just the primary one.
3. **S5 (log target) lowers R² but cuts the percentage error** (RF MAPE 113.9% → 77.2%).
   Training on log(price) optimises *relative* error. Cheap items get better predictions,
   expensive ones worse, and R² on the rupee scale is dominated by the expensive tail. Both
   numbers are reported for that reason.
4. **S5b is the first real gain:** R² 0.616, MAE ₹840 (down from ₹1,259 at S0). Only the
   non-linear model benefits; Linear Regression barely moves, so the length features act through
   interactions, not straight lines.
   - **Caveat to verify:** `desc_repeat` was counted over the whole dataset, test rows included.
     It contains no prices, but it is a whole-dataset statistic. To be recomputed on training
     data only in the next stage, to confirm the gain holds.

## Stages that made scores worse

| Stage | Effect | Reason |
|---|---|---|
| S4 | RF R² −0.071 | Label combinations collapsed into one primary label |
| S5 | RF R² −0.107 (MAPE −36.7 pts) | Log target trades rupee-scale fit for relative fit |
