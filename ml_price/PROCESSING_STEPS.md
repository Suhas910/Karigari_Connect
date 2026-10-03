# Processing Steps — Methods Reference

How every data step is done and recorded. Choices marked *decided on data* are made only once the
check has run, and the decision is written into that step's report.

## 1 — What every step records

Each step produces:

| Record | Location |
|---|---|
| Snapshot of the data after the step | `data/stages/SNN_<name>.csv.gz` |
| OpenRefine operation history (if done there) | `tool_exports/openrefine/SNN_<name>.json` |
| Before / after charts | `figures/SNN_<topic>_<before\|after>.png` |
| Step report | `reports/cleaning/step_NN_<name>.md` |
| Log entry | [PROJECT_LOG.md](PROJECT_LOG.md) |

**State profile** (captured before and after every step):

- Rows, columns, data types
- Missing values per column (count and %)
- Distinct values; top values for text and category columns
- Duplicate count
- For numeric columns:
  - mean, median, mode
  - standard deviation, variance
  - min, max, Q1, Q3, IQR
  - skewness, kurtosis
  - coefficient of variation

**Step report template:**

1. Goal
2. Tool (name, feature, version)
3. Before state
4. Finding, with example rows
5. Options considered: remove / replace / impute / flag / keep, with pros and cons
6. Decision and reason
7. After state
8. Effect on statistics: mean, median, std before vs after
9. Risks and limits

**Rules that apply to every step:**

- Raw files in `data/raw/` are never edited. Their SHA-256 checksums prove it.
- The test set is frozen before cleaning. Outlier removal and imputation apply to training data
  only; otherwise scores improve just because hard cases were deleted.
- The target (`price`) is never imputed. Filling in labels invents the answer key.

## 1b — What each tool can do for cleaning

Neither tool cleans anything on its own. Every change is an operation chosen by hand, and every
one is recorded.

**OpenRefine: inspection and edits on the table**

| Feature | What it does | Used in |
|---|---|---|
| Facets (text, numeric, custom) | Groups or filters rows by value; shows counts and blanks | Finding missing, invalid and duplicate values |
| Cluster and edit | Finds spelling variants (fingerprint key collision, nearest-neighbour / Levenshtein) and merges the ones you approve | 2.8 art-form consolidation |
| Transforms (GREL expressions) | Rewrites cell values with a formula, e.g. strip `₹` and commas, then convert to number | 2.2, 2.7 |
| Remove matching rows | Deletes the rows selected by a facet | 2.3, 2.6, removing missing prices |
| Fill down / blank down | Copies a value into empty cells below it, or blanks repeats | Only if the file's structure needs it |
| Undo/Redo history → Extract | Exports every operation as JSON that can be replayed on the raw file | The audit trail |

OpenRefine has **no mean or median imputation**. It edits values; it doesn't compute statistics
to fill gaps.

**Orange: statistics and imputation**

| Widget | What it does |
|---|---|
| Feature Statistics | Mean, median, mode, dispersion, min, max and missing % per column |
| Impute | Per column: don't impute, average (mean) / most frequent (mode), as a distinct value, model-based, random values, fixed value, or remove rows. **No median option**: read the median from Feature Statistics and enter it as a fixed value |
| Preprocess | Impute, normalise, discretise, remove sparse features — as one recorded chain |
| Outliers | Isolation Forest, Local Outlier Factor, One-class SVM, covariance estimator |
| Select Rows / Select Columns | Filter rows by condition; drop columns |

**Expected for this dataset:** the columns are mainly text plus price and art form, so there are
few numeric columns to impute. Most missing-value handling will be row removal (missing price) and
flags (missing art form or description). Mean and median become relevant for derived numeric
features, and for showing in the report why the median resists skew.

## 2 — Cleaning steps

| # | Step | Check | Method | Type |
|---|---|---|---|---|
| 2.1 | Integrate CSVs | Same schema? Overlapping rows? | Combine end to end; add `source_file` | Adding |
| 2.2 | Names and types | Price stored as text, symbols, commas | Parse to number; log every value that fails | Replacing |
| 2.3 | Exact duplicates | Identical rows | Remove | Removing |
| 2.4 | Near-duplicates | Same title + price; size/colour variants | Keep one, or keep all with `variant_group` — *decided on data* | Removing / Adding |
| 2.5 | Missing values | Missing % per column | Per column — see §3 | Mixed |
| 2.6 | Invalid values | Price ≤ 0, impossible values, wrong currency | Remove if impossible; flag if only suspicious | Removing / Flagging |
| 2.7 | Text cleaning | HTML, whitespace, broken characters, emoji | Normalise; keep the original column too | Replacing |
| 2.8 | Category consolidation | Spelling variants; rare art forms | Mapping table saved as CSV; rare ones → `other` below a documented threshold | Replacing |
| 2.9 | Outliers | Extreme prices | See §4 | Mixed |
| 2.10 | Derived features | — | `log_price`, title and description length, materials from text, set size, `has_image` | Adding |

## 3 — Missing-value methods

| Column | Method | Reason |
|---|---|---|
| `price` (target) | Remove the row | Imputing the target fabricates labels |
| `artform` | Infer from title keywords when unambiguous, else `unknown`; add `artform_imputed` flag | Keeps rows; the flag separates filled values from originals |
| `description` | Empty string + `has_description` flag | For text, being missing is itself a signal |
| Numeric features | Median | Skewed data pulls the mean; the median resists it. Report shows mean vs median before and after |
| Category features | Mode, or `unknown` | No mean exists for categories; `unknown` avoids distorting counts |

## 4 — Outlier methods

| Method | Rule | Tool |
|---|---|---|
| IQR on log(price) | Flag below Q1 − 1.5×IQR or above Q3 + 1.5×IQR | Orange Box Plot / OpenRefine facet |
| Z-score | Flag beyond ±3 standard deviations | Orange Feature Statistics |
| Isolation Forest | Model-based flag across several columns | Orange Outliers widget |

The report shows how many rows each method flags and how much they overlap. Each flagged group
is then:

- **Data error** → remove
- **Real premium item** → keep
- **In between** → cap the value at a limit

## 5 — Exploratory analysis

Each finding is written as: what was seen → what it means → which modelling decision it drives.

| Analysis | Tool | Drives |
|---|---|---|
| Distribution, skewness, kurtosis; raw vs log | Orange Distributions, Feature Statistics | Whether to model log(price) |
| Price by art form | Orange Box Plot | Feature strength; grouped split |
| ANOVA / Kruskal-Wallis | Orange Box Plot | Statistical evidence of an art-form effect |
| Pearson / Spearman correlation | Orange Correlations | Dropping redundant features |
| Top words per price band | Orange Text Mining (Bag of Words, TF-IDF) | Text features |
| Material co-occurrence | Orange Associate (Apriori) | Combination features |
| Clusters | Orange k-Means, Hierarchical, DBSCAN, Silhouette | Segment feature |
| 2-D map | Orange PCA | Visual check of the clusters |

## 6 — Integrating a second dataset

- A schema-mapping table: source column → target column, and what's missing on each side.
- Different currency and market, so the default is a **separate experiment**, not a merge.
- The same records as §1 are kept for it.

## 7 — Preprocessing for models

- All fitting (scaling, encoding, imputation) is learned from training data only.
- Encoding: one-hot vs target encoding for art form, compared.
- Scaling: Standard vs Robust, compared.
- Text: TF-IDF, then sentence embeddings, then PCA to shrink them.

## 8 — Split and evaluation

- **Frozen test set:** grouped by art form (Orange Select Rows), saved once to `data/splits/`.
- **Every model:** Orange Test and Score with "Test on test data".
- **Regression metrics:** R², MAE (₹), MAPE (%).
- **Classification metrics:** accuracy, precision, recall, F1, ROC-AUC, confusion matrix.
- **Error analysis:** broken down by art form and by price band.
- **Tuning:** manual setting changes in Orange; every try logged in [EXPERIMENTS.md](EXPERIMENTS.md).
