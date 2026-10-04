# Step 2.9 — Outliers (training data only)

| | |
|---|---|
| **Data** | Training set of split v3 (29,805 rows). The test set is never checked or changed |
| **Tool** | numpy / scikit-learn 1.9.1 (IsolationForest), run by Claude |
| **Flags saved** | `data/splits/train_outlier_flags.csv` (one column per method) |

## Three methods compared

| Method | Rule | Rows flagged | Prices flagged (₹) |
|---|---|---|---|
| IQR on log price | below Q1 − 1.5×IQR or above Q3 + 1.5×IQR (₹31 – ₹39,315) | **0** | — |
| z-score on log price | \|z\| > 3 | **12** | 28,490 – 37,990 |
| Isolation Forest | 1% contamination; features: log price, its deviation from the art form's median, title and description length | **293** | 120 – 37,990 |

Overlap: all 12 z-score rows are also in the Isolation Forest set; IQR flags nothing.

**Why IQR flags nothing here but 3,183 rows in the raw audit:** that count was on the raw rupee
scale. On the log scale the whole price range sits within the IQR limits. Most "outliers" on the
raw scale were just the long tail.

## What the flagged rows are

The most extreme rows are genuine premium crafts, not errors:

| Title | Price (₹) | Art form |
|---|---|---|
| Pink - Handspun Handloom Silk Pochampally Patola Ikat Saree with Zari Border 06 | 37,990 | pochampally ikat weaving |
| Orange - Handspun Handloom Silk Pochampally Ikat Saree 02 | 34,490 | pochampally ikat weaving |
| Black - Handspun Handloom Full Zari Work Fine Cotton Venkatgiri Saree 47 | 34,990 | other |
| Maroon - Handloom Mulberry Silk Patola Ikat Pochampally Saree 16 | 29,990 | pochampally ikat weaving |

Handspun silk with zari work explains these prices.

## Effect of removing them (stage S6b settings, scored on the unchanged test set)

| Training data | Rows | Ridge R² | Ridge MAE (₹) | Ridge MAPE (%) | Price-band F1 |
|---|---|---|---|---|---|
| All rows (S6b) | 29,805 | **0.707** | **730** | 42.0 | 0.762 |
| z-score rows removed | 29,793 | 0.705 | 731 | 41.9 | 0.774 |
| Isolation Forest rows removed | 29,512 | 0.700 | 735 | 41.3 | 0.768 |

## Decision: keep all rows

- **No data errors were found.** The flagged rows are real high-end or unusually priced crafts.
- **Removing them doesn't help** the main regression metrics (R² and MAE get slightly worse),
  because the model then never sees expensive silk sarees, and still has to price them in test.
- **Fairness angle:** deleting expensive handwork teaches the model that crafts are cheap. That's
  exactly the bias a fair-pricing project should avoid.
- **Remaining use:** the Isolation Forest flags will be reused for project part 7 (underpricing
  detector), where unusual prices *relative to their art form* are the signal, not noise.
