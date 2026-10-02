# Datasets

Metadata below was checked through the Kaggle and Hugging Face public APIs on 2026-10-02.
Column lists come from the dataset descriptions. Confirm them after download, before writing
any loading code.

## Primary — Indian Handicraft Products (Kaggle)

- **Link:** https://www.kaggle.com/datasets/hrishikeshb80/indian-handicraft-products
- **Licence:** MIT
- **Size:** about 37,300 listings across 3 CSVs (`complete_venues_1/2/3.csv`, about 9 MB each),
  plus an images folder (about 1.1 GB in total)
- **Columns (per description):** `product_title`, `product_description`, `price`, `artform`,
  image URL
- **Why:** Indian handicraft items with an art-form label, free text and a photo. This is the
  closest public match to a Karigari Connect listing.
- **Limits:** listing prices, not sales. The source store isn't stated, so check the domain and
  the price currency on download. There are no labour-hour or material-cost fields, so the app's
  wage-floor formula **cannot** be run on this data as a baseline.

## Secondary — Amazon Reviews 2023, Handmade Products (McAuley Lab)

- **Link:** https://huggingface.co/datasets/McAuley-Lab/Amazon-Reviews-2023
  (file `raw/meta_categories/meta_Handmade_Products.jsonl`, also available as parquet)
- **Mirror:** https://www.kaggle.com/datasets/dhruvgoel0988/handmade-products (about 400 MB
  JSONL, licence listed as "Unknown", so prefer the original)
- **Fields:** title, price (USD), features, description, categories, images, rating counts
- **Why:** large and well documented, and widely cited in research. Good for showing that the
  pipeline transfers to a second market (global handmade products, priced in USD).
- **Limits:** many rows have a missing price, so drop them. The data is not India-specific.
- **Citation:** Hou et al., "Bridging Language and Items for Retrieval and Recommendation",
  2024.

## Optional / supporting

| Dataset | Licence | Use |
|---|---|---|
| [Flipkart Products (PromptCloud)](https://www.kaggle.com/datasets/PromptCloudHQ/flipkart-products), about 20k rows, has `retail_price`, `discounted_price`, `product_category_tree`, `description` | CC BY-SA 4.0 | Filter to home-décor and handicraft categories for an Indian e-commerce comparison |
| [Handmade Accessory Making Time, India 2026](https://www.kaggle.com/datasets/deeshagoswami/handmade-accessory-making-time-india-2026), 32 designs from one Ahmedabad studio, DOI 10.5281/zenodo.22913240 | CC BY 4.0 | Rare real data on making time. Too small to train on, but useful in the report to discuss labour-based pricing |
| [Amazon Saree Database 2022](https://www.kaggle.com/datasets/rishidj/amazon-saree-database-2022), about 90 KB | Unknown | Small saree-only side experiment. The licence is unclear, so don't redistribute it |

## Rejected

- `reshmikaja/textile-dataset`: a supplier inventory with cost and sale price, but no
  product-describing features beyond the item name. It's not a handicraft listing.
- Etsy scrapes (`dimakyn/etsy-items-price`, `rkkaggle2/etsy-listings`): small, from 2020,
  marked "© Original Authors", with almost no attributes.
- Image-only sets (IndoFashion, saree pattern sets): no prices.

## Download

1. Open the dataset page and click **Download** (needs a free Kaggle login).
2. Unzip it and copy the 3 CSVs into `data/raw/handicraft/`. Skip the `images/` folder (about 1.1 GB);
   it is git-ignored anyway.
3. Don't open the CSVs in Excel and save them. Excel can silently change encodings and number
   formats, and the raw files must stay byte-identical to the download.
