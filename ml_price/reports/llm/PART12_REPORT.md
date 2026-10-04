# Part 12 — LLM Attribute Extraction and Prompt Engineering

**Syllabus:** Unit V (large language models, prompt engineering).

| | |
|---|---|
| **Script** | `scripts/part12_llm_extract.py` |
| **Model** | `gemini-3.5-flash` (Google AI Studio API), temperature 0, JSON output forced by a response schema |
| **Rate limit** | 20 products per request, at most 12 requests per minute (free tier allows 15) |
| **API key** | Read from `ml_price/.env` (git-ignored); never printed or logged |

## Why this part exists

Apriori (part 6) showed that the keyword material extractor used by the knowledge graph confuses
**tools** and **alloys** with materials:

- kalamkari → "bamboo": the *kalam* pen is bamboo
- block printing → "wood": the printing *blocks* are wooden
- oxidised metal craft → "silver": listings say "German silver", which contains no silver

An LLM reads the sentence, not just the word, so it can tell "printed with wooden blocks" from
"made of wood".

## Gold-standard sample (80 products, training split)

| Group | Rows | How chosen |
|---|---|---|
| trap: bamboo pen | 10 | kalamkari listings mentioning bamboo |
| trap: wooden blocks | 10 | block-printing listings mentioning wood |
| trap: German silver | 10 | listings mentioning "german silver" |
| trap: silk-like | 10 | art silk, silk thread, mercerised cotton |
| random | 40 | random distinct descriptions |

**Labelled by Claude, reading each title and description against written rules** (not by a
domain expert). The rules:

- A material is what the product is made of, not a tool used to make it.
- German silver isn't silver.
- Imitation fibres don't count: art silk, viscose and modal aren't silk; foam or artificial
  leather isn't leather.
- Mercerised cotton is cotton.
- Zari counts when there is zari work.
- Ambiguous cases are noted in the file.

Labels and notes: `reports/llm/gold_sample.csv`. 13 products have no material from the list.

## The two prompts

| Version | Content |
|---|---|
| **v1 zero-shot** | Task + the 17-material vocabulary only |
| **v2 engineered** | v1 + 6 explicit rules (tool vs material, German silver, imitation fibres, processed fibres, zari, "leave out unknowns") + 3 worked examples (few-shot) |

Both return, per product: materials, item type, set size, size text, handloom yes/no/unknown.

## Results (materials, 80 products)

| Extractor | Precision | Recall | F1 | Exact match | Wrong materials added | Materials missed |
|---|---|---|---|---|---|---|
| Keywords (used in parts 3–7) | 0.638 | 0.926 | 0.755 | 0.425 | 50 | 7 |
| LLM v1 zero-shot | 0.798 | **1.000** | 0.888 | 0.738 | 24 | 0 |
| **LLM v2 engineered** | **0.979** | 0.979 | **0.979** | **0.950** | **2** | 2 |

**Exact match by group**

| Group | Keywords | LLM v1 | LLM v2 |
|---|---|---|---|
| bamboo pen | 0.0 | 0.8 | **1.0** |
| wooden blocks | 0.0 | 1.0 | **1.0** |
| German silver | 0.0 | **0.0** | **0.8** |
| silk-like | 0.8 | 1.0 | **1.0** |
| random | 0.65 | 0.775 | **0.95** |

Side-by-side answers for all 80: `reports/llm/part12_gold_side_by_side.csv`.

## What the comparison shows

1. **Context beats keywords.** Even with no special instructions, the LLM never called a block
   print "wood" (wooden-blocks group: 0.0 → 1.0).
2. **Zero-shot still fails on domain knowledge.** v1 marked **every** German-silver product as
   Silver (0/10), and read "foam leather" as Leather. These aren't reading errors; the model
   needs the domain fact.
3. **Prompt engineering fixes it.** Six rules and three examples took exact match from 0.738 to
   **0.950**, and wrongly added materials from 24 to 2. German silver went from 0/10 to 8/10.
4. **The remaining 4 disagreements are borderline:**

   | Product | Gold | v2 | Who is right? |
   |---|---|---|---|
   | German silver-plated earrings ×2 | Stone | (none) | v2 left out decorative "stones": a genuine miss |
   | Handmade paper notebook (paper from cotton waste) | Paper | Paper, Cotton | Debatable gold choice |
   | "Bamboo wood" earrings | Bamboo | Bamboo, Wood | Debatable gold choice |

5. **Reliability:** the API returned temporary server errors on 9 requests. The script backed
   off and retried each one. All 80 products were answered in both runs (no missing ids).

## Not done: LLM features for every product (stage S10)

Extracting attributes for all 37,257 products would take about 1,860 requests of 20 products.
At 12 requests per minute that is **2.6 hours**, before any daily request limit. So:

- The comparison above is the evaluated deliverable for part 12.
- A full run could instead use the **12,884 unique descriptions** (most products share one) in
  batches of 40, about 320 requests or roughly 27 minutes, if the daily quota allows. Its
  attributes (corrected materials, set size, size text) would then become stage S10.
  **Decision pending.**
