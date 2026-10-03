# Guide 01 — Raw Audit Cross-Check (OpenRefine + Orange)

Goal: see the raw data in the tools yourself, and confirm the numbers in
[step_00_raw_audit.md](../reports/cleaning/step_00_raw_audit.md). **Nothing is changed in this
guide.** The OpenRefine project you create here is the one used for cleaning later.

## A. OpenRefine: create the project

1. Open OpenRefine (a browser tab opens at `127.0.0.1:3333`).
2. **Create project → This computer → Choose files**, and select all three
   `ml_price/data/raw/handicraft/complete_venues_*.csv` files. Click **Next**.
3. On the file-selection screen, keep all 3 ticked. Click **Next**.
4. On the preview screen, check:
   - **Character encoding:** `UTF-8`
   - **Parse data as:** CSV
   - ✅ **Store file source** (adds a `File` column so each row keeps its source file)
   - ❌ **Parse cell text into numbers, dates…** — leave unticked; types get fixed in the
     cleaning step, where the change is recorded
5. **Project name:** `handicraft_S00_raw` → **Create project**.

✅ Check: the top shows **37273 rows**.

## B. OpenRefine: confirm the audit numbers

For each check, use the ▼ menu on the column header. Take a screenshot of each facet panel
(Cmd + Shift + 4) and save it into `ml_price/figures/` under the name given.

| # | Column ▼ → menu | What to look at | Expected | Screenshot name |
|---|---|---|---|---|
| 1 | `File` → Facet → Text facet | Rows per file | 15520 / 11979 / 9774 | `S00_or_rows_per_file.png` |
| 2 | `artform` → Facet → Customized facets → Facet by blank | `true` count | 16 | `S00_or_artform_blank.png` |
| 3 | `artform` → Facet → Text facet | Number of choices (shown at the top of the facet) | 733, plus a `(blank)` entry for the 16 empty cells | `S00_or_artform_choices.png` |
| 4 | `product_title` → Facet → Customized facets → Duplicates facet | `true` count | 7240* | `S00_or_title_duplicates.png` |
| 5 | `price` → Facet → Custom numeric facet → expression `value.toNumber()` → OK | Histogram range; numeric vs non-numeric count | 50 to 37990; non-numeric 0 | `S00_or_price_histogram.png` |

\* OpenRefine's duplicates facet marks **every** copy, including the first (5,200 repeats +
2,040 originals = 7,240). The report's 5,200 counts only the repeats. Both are correct.

Close all facets when done (the ✕ at the top of the facet panel). **Don't run any edit operation
in this project yet.**

## C. Orange: the price distribution, raw vs log

1. Open Orange and drag a **File** widget onto the canvas. Double-click it and open
   `complete_venues_1.csv` (one file is enough to see the shape).
   - In the column list, set `price` to **numeric** / **feature**. Set the text columns to
     **meta**.
2. Connect **File → Distributions**. Choose `price`. Save the image with the save icon at the
   bottom left → `figures/S00_orange_price_raw.png`.
3. Connect **File → Feature Constructor → Distributions**. In Feature Constructor, add a
   numeric feature `log_price` with expression `log(price)`, then show `log_price` in the new
   Distributions → `figures/S00_orange_price_log.png`.
4. **File → Save As** → `ml_price/tool_exports/orange/S00_price_distribution.ows`.

## D. Tell Claude

Say "guide 01 done" and mention any number that didn't match. Claude will:

- add your screenshots to the step-00 report
- note any mismatches and explain them
- tick the to-do items, log the step, and commit and push
