# Data Card — Indian Handicraft Products

| Field | Value |
|---|---|
| Source | https://www.kaggle.com/datasets/hrishikeshb80/indian-handicraft-products |
| Licence | MIT |
| Downloaded | 2026-10-03, through the Kaggle website (CSVs only; the images were not downloaded) |
| Files | `complete_venues_1.csv` (15,520 rows), `complete_venues_2.csv` (11,979), `complete_venues_3.csv` (9,774) |
| Total rows | 37,273 |
| File sizes | 9,000,635 / 9,001,045 / 8,963,041 bytes; identical to Kaggle's file listing |
| Integrity | SHA-256 in [`data/raw/SHA256SUMS.txt`](../data/raw/SHA256SUMS.txt) |
| Encoding | UTF-8, comma-separated, quoted fields; every row has exactly 5 fields |

## Columns

| Column | Type in the file | Content |
|---|---|---|
| `product_title` | text | Product name, 20–154 characters |
| `product_description` | text | Marketing description, 43–1,611 characters |
| `price` | whole number, stored as text | Listing price. All values 50–37,990 with no symbols, so read as INR (see limits) |
| `image_paths` | text holding a Python-style list | Exactly one image path per row, e.g. `['images/….jpg']` |
| `artform` | text holding a Python-style list | 1–6 craft labels per row, e.g. `['ajrakh block printing', 'natural dyed']` |

## Known limits

- **Asking prices, not sale prices.** Nothing records what was actually sold, or for how much.
- **Source store not named** by the dataset author. The currency is inferred from the value range
  and from the fact that 61.7% of prices end in "90" (e.g. 2590), a retail pricing pattern.
  Treat INR as an assumption.
- **No labour hours or material costs**, so the Karigari Connect wage-floor formula can't be run on
  this data.
- **One retailer's catalogue**, so the prices reflect that store's pricing policy, not the
  whole market.
