# Cleaning Report — S00 → S05

**Tool:** OpenRefine 3.10.1, project `handicraft_S00_raw`. Claude sent each step to OpenRefine as
operations through its API; OpenRefine applied them and recorded them in its Undo/Redo history
(14 operations). Statistics: pandas 3.0.6 on each exported snapshot.
**Decisions applied:** D1, D2, D3 as recommended in [step_00 §7](step_00_raw_audit.md),
approved by the project owner on 2026-10-04.

## Records

| Record | Path |
|---|---|
| Snapshot after each stage | `data/stages/S01_types.csv.gz` … `S05_derived.csv.gz` |
| Final cleaned dataset | `data/final/handicraft_clean.csv.gz` |
| OpenRefine history after each stage | `tool_exports/openrefine/S0N_*_history.json` |
| **Replayable recipe** (all 14 operations) | `tool_exports/openrefine/cleaning_operations_replayable.json` — in OpenRefine: Undo/Redo → Apply… → paste, on a fresh import of the raw files |

## Summary

| Stage | Change | Method type | Rows | Columns | Blank cells |
|---|---|---|---|---|---|
| S00 raw | — | — | 37,273 | 5 | 16 |
| S01 types | Price → number; `image_file` extracted | Replacing, adding | 37,273 | 7* | 16 |
| S02 missing | Removed 16 rows with no art form (D3) | **Removing** | **37,257** | 7 | 0 |
| S03 variants | `variant_group` + `variant_group_size` (D2) | Adding | 37,257 | 9 | 0 |
| S04 art form | 3 spelling merges; `artform_all`, `artform_count`, `primary_artform` (D1); rare → `other` | Replacing, adding | 37,257 | 12 | 0 |
| S05 derived | `log_price`, `title_len`, `desc_len`, `desc_repeat` | Adding | 37,257 | 16 | 0 |

\* Includes OpenRefine's `File` column (the source file of each row).

**Effect on price statistics**

| Statistic | S00 raw | S05 final | Change |
|---|---|---|---|
| Mean (₹) | 2,061.11 | 2,061.46 | +0.35 |
| Median (₹) | 850 | 850 | 0 |
| Std deviation (₹) | 2,914.86 | 2,915.40 | +0.54 |
| Skewness | 3.613 | 3.612 | −0.001 |
| Kurtosis | 19.246 | 19.237 | −0.009 |
| Min / Max | 50 / 37,990 | 50 / 37,990 | — |

Cleaning removed only 16 rows (0.04%), so the target distribution is essentially unchanged.
That's the intended outcome: cleaning fixed structure, it didn't reshape the prices.

---

## S01 — Types

| | Before | After |
|---|---|---|
| `price` | text (`"550"`) | number (`550`) |
| `image_paths` | `['images/elephant-…_1.jpg']` | kept; new `image_file` = `elephant-…_1.jpg` |

- **Exact duplicates (step 2.3):** checked, **0 found** (step_00 §1). No operation needed.
- **Text cleaning (step 2.7):** checked, no leading/trailing spaces, no double spaces, no HTML,
  no broken characters. No operation needed.
- **Why:** numbers must be numeric for any statistics or model. The list-in-text format of
  `image_paths` is unusable as-is.

## S02 — Missing values (D3)

| | Before | After |
|---|---|---|
| Rows | 37,273 | 37,257 |
| Blank `artform` | 16 | 0 |
| Blank cells, all columns | 16 | 0 |

- **Removed rows:** 13 from file 1 and 3 from file 2. Prices ₹250–2,250, e.g. "Ganesha -
  Traditional Burdwan Wood Craft Handpainted Hanging 57".
- **Options considered:** remove; infer the art form from the title plus a flag; keep as `unknown`.
- **Decision:** remove. 16 rows (0.04%) is negligible, and inferring labels adds error to the
  column the split will be grouped on.
- **Price was never imputed.** It had no blanks.

## S03 — Design variants (D2)

- **Key:** `variant_group` = OpenRefine `fingerprint(title)` + ` | ` + price. Fingerprint
  lower-cases, strips punctuation and sorts words, so trivially different spellings of a title
  land in one group.
- **Result:** 32,356 groups. 30,346 are single rows; **6,911 rows sit in 2,010 multi-row
  groups**, the largest with 87 rows.
- **Decision:** keep every row; no rows removed. When the test set is made, each group goes
  entirely to train or entirely to test, so a variant never "leaks" its twin's price.

## S04 — Art forms (D1 + consolidation)

**Spelling merges** (found by fingerprint matching and string similarity):

| From | To | Why |
|---|---|---|
| `shibori tye dye` (339) | `shibori tie dye` (349) | Spelling mistake |
| `tangaliyan weaving` (14) | `tangaliya weaving` (14) | Spelling variant |
| `​bhil folk art` (8) | `bhil folk art` (6) | Invisible zero-width space |

Not merged, despite similar spelling (different crafts): bagh vs bagru block printing; godna vs
gond folk art; mandala vs mandana art.

**New columns**

| Column | Content |
|---|---|
| `artform_all` | All labels, e.g. `ajrakh block printing \| natural dyed` |
| `artform_count` | Labels per row (1: 19,725 · 2: 13,471 · 3: 3,260 · 4: 554 · 5: 227 · 6: 20) |
| `primary_artform` | First label **not** in the generic list: `handmade`, `natural dyed`, `plain solid`, `handloom`, `hand painted`, `upcycled`, `fabart`. If every label is generic, the first label is used |

- **Check:** an independent pandas implementation of the same rule gave **0 mismatches** with
  OpenRefine's result.
- **Rare labels:** 65 primary art forms had fewer than 20 rows (551 rows in total) and became
  `other`. The 20-row threshold is a choice, not a law: below it there are too few examples to
  learn or test a craft's price.
- **Result:** 129 primary art forms.
- **Limit:** 6,434 rows have only generic labels, so their primary art form stays generic
  (`fabart` 3,093, `handmade` 1,700, `plain solid` 1,186, …). The data offers nothing more
  specific for them.

**Largest primary art forms and their median prices**

| Primary art form | Rows | Median price (₹) |
|---|---|---|
| fabart | 3,093 | 390 |
| oxidised metal craft | 1,831 | 650 |
| ajrakh block printing | 1,744 | 790 |
| handmade | 1,700 | 490 |
| sanganeri block printing | 1,604 | 850 |
| bandhani tie dye | 1,503 | 2,990 |
| plain solid | 1,186 | 590 |
| pochampally ikat weaving | 1,179 | 1,590 |
| kalamkari block printing | 1,083 | 850 |
| bead work | 1,071 | 550 |

Medians range from ₹390 to ₹2,990 across just the ten largest groups, an early sign that art
form carries real price information.

## S05 — Derived features

| Column | Formula | Summary |
|---|---|---|
| `log_price` | `ln(price)` | mean 7.014, median 6.745, std 1.058, **skewness 0.512** (raw: 3.612) |
| `title_len` | characters in title | mean 58.1, median 56, range 20–154 |
| `desc_len` | characters in description | mean 540.4, median 465, range 43–1,611 |
| `desc_repeat` | rows sharing the exact description | median 5, max 171 |

`desc_repeat` measures how templated a description is. Highly repeated descriptions carry
little product-specific information, which matters for the text features in S6 and S9.

## S06 — Correction: the `bhil folk art` label (added 2026-10-04)

The S04 merge of `​bhil folk art` into `bhil folk art` **didn't work**. The raw data contains the
six literal characters `\u200b` as text, not an invisible character. The S04 audit had decoded
them while parsing, and the S04 expression aimed at the real character, so it matched nothing.
The pandas cross-check in S04 decoded the text the same way, which hid the miss.

- **Fix:** 4 more OpenRefine operations (18 in total). The first pair aimed at the invisible
  character again and changed nothing. The second pair replaced the literal text `\u200b` in
  `artform` and `artform_all`.
- **Result:** `bhil folk art` now has all 14 rows; 201 distinct labels (was 202).
- **Effect:** `primary_artform` was unaffected (both spellings had already become `other`, being
  under 20 rows). The split assignment was regenerated and verified identical.
- **Snapshot:** `data/stages/S06_zwsp_fix.csv.gz` is now the final dataset; the replayable
  recipe has 18 operations.
- **Left as is:** 7 real invisible characters inside product descriptions (no effect on features).

## Deliberately not done yet

| Step | Why it waits |
|---|---|
| 2.9 Outliers | Must run on **training data only**, after the frozen test set exists. On log price only 10 rows are candidates (step_00 §3) |
| Imputation | Nothing left to impute: 0 blank cells after S02 |

## Next

Create the frozen train/test split: grouped by `variant_group` (D2) and stratified by
`primary_artform`. Then experiment stage S0: first baseline scores.
