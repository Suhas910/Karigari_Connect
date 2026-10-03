# Guide 00 — Setup

Versions current on 2026-10-03, from the Homebrew cask index. Install these exact versions, so the
report can name them.

| Tool | Version | Used for |
|---|---|---|
| OpenRefine | 3.10.1 | Cleaning (parts 1) |
| Orange Data Mining | 3.40.0 (Apple Silicon build) | Analysis and ML (parts 2, 5–8, 10–11, 13–15) |
| Protégé | 5.6.9 | Knowledge graph and rules (parts 3–4) |

## 1. Install the three apps

**Option A, Terminal** (one line each; Homebrew is already on this Mac):

```bash
brew install --cask openrefine
```

```bash
brew install --cask orange
```

```bash
brew install --cask protege
```

**Option B, browser:**

| Tool | Download page |
|---|---|
| OpenRefine | https://openrefine.org/download → macOS |
| Orange | https://orangedatamining.com/download → macOS, Apple Silicon |
| Protégé | https://protege.stanford.edu → Download → macOS |

Drag each app into Applications.

**If macOS says an app "can't be opened"** (common with OpenRefine and Protégé, which aren't
signed by Apple): right-click the app in Applications → **Open** → **Open**. This is needed only
the first time.

## 2. Orange add-ons

1. Open Orange.
2. Menu **Options → Add-ons…**
3. Tick:
   - **Text** (text mining: TF-IDF, embeddings)
   - **Associate** (Apriori: frequent itemsets, association rules)
   - **Explain** (SHAP)
   - **Image Analytics** (optional — only for the image stretch goal)
4. Click **OK** and wait for the install to finish.
5. Restart Orange. The new widget groups appear in the left panel.

## 3. Check that each app starts

| App | What you should see |
|---|---|
| OpenRefine | A browser tab opens at `http://127.0.0.1:3333` with "Create project". Keep the small OpenRefine window open while using it; closing it stops OpenRefine |
| Orange | An empty canvas, widget groups on the left, including Text Mining, Associate and Explain |
| Protégé | A window with tabs: Active ontology, Entities, Classes… |

## 4. Download the dataset

1. Log in to Kaggle (free account).
2. Open https://www.kaggle.com/datasets/hrishikeshb80/indian-handicraft-products
3. The full download is about 1.1 GB because of the photos. Rather than downloading the whole
   archive, open the **Data** tab, go into `Handicraft_products/`, and download only these three
   files, one by one, with the download icon next to each:
   - `complete_venues_1.csv`
   - `complete_venues_2.csv`
   - `complete_venues_3.csv`
4. Move the three files into `ml_price/data/raw/handicraft/` (create the `handicraft` folder).
5. **Don't open them in Excel or Numbers.** Saving from those apps can change the files.

## 5. Tell Claude

Say "setup done". Claude then:

- records the checksums of the three CSVs
- updates `TODO.md` and `PROJECT_LOG.md`
- writes Guide 01 (the raw audit in OpenRefine)
- commits and pushes
