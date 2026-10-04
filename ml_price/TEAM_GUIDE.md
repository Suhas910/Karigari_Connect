# Team Guide — `ml_price/` (Handicraft Price Prediction)

For Karigari Connect teammates. Read this first; it takes 5 minutes.

## What this is (and isn't)

- **Utsav's AI&ML course project** (20-mark component), built **beside** Karigari Connect on the
  branch `ai-ml-price-extension`. Everything lives in this `ml_price/` folder.
- It **does not change the app.** No app code, no backend endpoint and no pricing logic was
  modified. The app's wage-floor function (`backend/app/services/pricing_service.py`,
  `calculate_price`) is only *imported read-only* by the demo.
- **Don't merge this branch into `main` or `frontend-avi`.** It's a separate study. Ideas that
  could move into the app are listed at the end, to discuss with Utsav first.

**In one line:** a model that estimates a handicraft's *market* price from its title, description,
craft labels and photo (R² 0.806, typical error 34%), wrapped in an advisor that never suggests
less than the app's fair-wage floor.

## The 5-minute tour

| Read | What you get |
|---|---|
| [reports/final/FINAL_REPORT.md](reports/final/FINAL_REPORT.md) | The whole project in one document: data, cleaning, models, results, ethics, syllabus coverage |
| [EXPERIMENTS.md](EXPERIMENTS.md) | Scoreboard: how every change moved the scores (S0 → S12-img) |
| [figures/experiments_progress.png](figures/experiments_progress.png) | The same as a chart |
| [reports/models/PARTS_8_14_16_REPORT.md](reports/models/PARTS_8_14_16_REPORT.md) | Bias audit and the price advisor (most relevant to the app) |
| [PROJECT_LOG.md](PROJECT_LOG.md) | Dated diary of every step, including mistakes found and fixed |

## Run the demo (about 10 minutes, mostly the install)

Needs Python 3.12+ (tested on 3.14) and about 2 GB of disk for the environment.

```bash
git fetch origin && git switch ai-ml-price-extension
```

```bash
cd ml_price && python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt
```

```bash
.venv/bin/streamlit run app/streamlit_app.py
```

The page opens at http://localhost:8501. Paste a product title and description, choose art-form
labels, optionally add material cost, labour hours and a state code (KA, TG, UP …), and press
**Advise**. You get:

- a suggested price range and point estimate
- the fair-wage floor (from the app's own wage tables; "unavailable" if no verified rate exists)
- a verdict on a listed price
- cautions
- the 10 most similar catalogue listings as evidence

**This works without any API key or download.** The trained models are committed in `models/`.
The setup above was tested on a fresh clone.

**Optional, Gemini explanation (RAG):** the "Also ask Gemini…" checkbox needs your own Google AI
Studio key:

```bash
cp .env.example .env
```

Then put your key in `.env`. It is git-ignored, so **never commit it, and never paste a key into
chat or an issue.**

## What is *not* in git, and how to get it

| Missing locally | Why | How to get it (only if you need it) |
|---|---|---|
| `.env` | Secret API key | Your own key in a copy of `.env.example` |
| `.venv/` | Python environment | `requirements.txt` (above) |
| `data/raw/handicraft/images/` (37,282 photos, 1.1 GB) | Too big for GitHub | Download the zip from the [Kaggle dataset](https://www.kaggle.com/datasets/hrishikeshb80/indian-handicraft-products) and copy its `images/` folder there. Checksums: `data/raw/IMAGES_SHA256SUMS.txt` |
| `data/features/image_embeddings_squeezenet.tab` (306 MB) | Too big | Orange workflow `tool_exports/orange/P13_image_embedding.ows` on the photos. The compressed version used by the models, `image_pca.csv.gz`, *is* committed |
| `data/features/sentence_emb_minilm.npy` (57 MB) | Regenerable | `PYTHONPATH=scripts .venv/bin/python scripts/part17_sentence_embeddings.py encode` |

Everything else is committed: raw CSVs with checksums, every cleaning snapshot, tool exports, the
ontology, features, models, figures and reports.

## Reproduce a result

Run from `ml_price/`. Each script's top comment explains what it does.

```bash
PYTHONPATH=scripts .venv/bin/python scripts/evaluate_stage.py S12-img
```

Stage names are listed in [EXPERIMENTS.md](EXPERIMENTS.md). The test split is frozen
(`data/splits/`), so scores come out the same. Scripts that call Gemini (`part12_llm_extract.py`,
`part18_rag.py`) need a key and use free-tier quota. Their outputs are already committed, so you
don't need to re-run them.

## Folder map

| Folder | Contents |
|---|---|
| `app/` | Advisor logic (`advisor.py`), RAG module (`rag.py`), Streamlit page |
| `scripts/` | One script per step or part; `evaluate_stage.py` is the scoring harness |
| `data/` | `raw/` (original CSVs + checksums) → `stages/` (snapshot per cleaning step) → `final/` → `splits/` (frozen train/test) → `features/` |
| `models/` | Trained advisor model + FAISS index used by the demo |
| `reports/` | One report per part; `final/` holds the final report and viva sheet |
| `tool_exports/` | OpenRefine recipe, Orange workflows (`.ows`), ontology (`.owl`, opens in Protégé) |
| `figures/` | Every chart and tool screenshot |
| `guides/` | Step-by-step tool guides used during the project |

## Findings that matter for Karigari Connect

These are observations from this study, not changes to the app. Discuss before acting on any.

1. **A market model must never set the price floor.** The bias audit shows it pulls prices toward
   the middle (cheap items over-priced, expensive ones under-priced) and under-prices some crafts,
   e.g. kalamkari block printing at about 74% of the real price. This supports the app's design:
   the wage floor from official notifications comes first.
2. **A suggested market range can sit *next to* the floor:** "the floor is ₹X; similar products
   sell for ₹A – ₹B", with the similar listings shown as evidence.
3. **LLM attribute extraction needs explicit rules.** On an 80-product test, a plain prompt called
   "German silver" jewellery *silver* every time. Six written rules and three examples fixed it
   (F1 0.89 → 0.98). That's relevant to the app's Gemini catalogue generation and to provenance
   claims such as material and handloom.
4. **Near-duplicate listings fool evaluations.** Colour and size variants make a random split look
   far better than reality. Any model the app trains should be tested on unseen product families.
5. **Product size is often missing from text** (only 3,075 of 37,257 titles state one), and it
   drives price. The photo helped the model, and asking artisans for dimensions would help more.
   This fits the planned "Dimensions" fields.

## Questions

Ask Utsav. Branch rules for this folder: commits only under `ml_price/`, no force-pushes, no
merges into `main` / `frontend-avi`.
