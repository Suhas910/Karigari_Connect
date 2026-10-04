# Part 18 — Retrieval-Augmented Generation (RAG)

**Syllabus:** Unit V (retrieval-augmented generation, vector databases, large language models,
prompt engineering).

| | |
|---|---|
| **Module** | `app/rag.py` (used by the evaluation and by the advisor page) |
| **Evaluation** | `scripts/part18_rag.py` → `reports/llm/part18_rag.json`, `part18_rag_answers.csv` (every answer and reason), `part18_run.log` |
| **LLM** | `gemini-3.5-flash-lite`, temperature 0, JSON forced by a response schema; 16 requests in total |
| **Retriever** | FAISS exact inner-product index over the 29,805 **training** listings, LSA vectors (better than MiniLM, part 17), 10 neighbours |
| **Privacy and leakage** | The API key stays in `.env`. Only training prices are sent as evidence; the test product's own price never is |

## 1. The three steps

1. **Retrieve:** the product's text goes through the same vectoriser as the index. FAISS returns
   the 10 most similar training listings with their real prices.
2. **Augment:** those listings go into the prompt as numbered evidence, one line each in the form
   `[number] ₹price | listing title`.
3. **Generate:** Gemini returns an estimate, a low–high range, the numbers of the listings it
   relied on, a match-quality label (good / partial / poor) and a one-sentence reason.

**Grounding rules in the prompt:** use only the evidence, no outside price knowledge; cite the
listings relied on; ignore listings that are a different kind of item; widen the range when
matches are poor.

## 2. Test: 40 products, one per product family

40 test products, each from a different product family (seed 42), so no product line counts twice
(the lesson from the part 15 revision). The same 40 products under four methods:

| Method | R² | MAE ₹ | Median error | 80%-range coverage | Range width ÷ estimate |
|---|---|---|---|---|---|
| LLM **without** retrieval (general knowledge) | 0.34 | 1,762 | 41.7% | 32.5% | 0.71 |
| **RAG** (LLM + 10 retrieved listings) | **0.73** | 1,211 | **24.6%** | 52.5% | 0.32 |
| FAISS neighbour median (retrieval, no LLM) | 0.73 | 1,567 | 31.4% | — | — |
| Ridge S12-img (best model) | **0.85** | **1,027** | 26.7% | — | — |

**What it shows**

1. **Retrieval is what makes the LLM useful.** Without evidence, Gemini guesses from general
   knowledge (R² 0.34, typical error 42%). With 10 real listings it reaches R² 0.73 and a typical
   error of 25%. Same model, same products; only the retrieved context changed.
2. **The LLM adds judgement on top of retrieval.** Against the plain median of the same 10
   listings, RAG lowers MAE from ₹1,567 to ₹1,211 and the typical error from 31% to 25%. It
   sets aside listings that are a different item, e.g. sarees retrieved for a dupatta (Kutch
   example below).
3. **The trained model is still the best estimator overall** (R² 0.85). On the typical product,
   RAG's median error (24.6%) is about the same as Ridge's (26.7%). With 40 products these two are
   not clearly different.
4. **RAG's ranges are overconfident:** 52.5% coverage instead of 80%, often a single price. The
   same failure as the raw quantile models in part 9. Use the conformal or Ridge band for ranges.

## 3. Grounding and self-assessment

| Check | Result |
|---|---|
| Citations refer to real evidence numbers (1–10) | **100%** of answers |
| Estimate lies within the evidence's price span | **100%** of answers |
| Match quality given by the model | good 19 · partial 19 · poor 2 |

**The model's own match-quality label predicts its error:**

| Match quality | Products | Median error |
|---|---|---|
| good | 19 | **17.6%** |
| partial | 19 | 33.6% |
| poor | 2 | 178% |

That makes the label a useful caution, like the similarity threshold in part 11.

## 4. Examples

| Product (real price) | RAG answer | Reason given |
|---|---|---|
| Orange Thread Work German Silver Necklace Set (₹690) | ₹950, **good**, cites 1, 2, 3, 4, 7 | "The cited listings are all thread work German silver necklace sets with matching earrings." |
| Grey Kutch Bhujodi Cotton Dupatta (₹3,400) | ₹2,590, partial, cites 1, 2 | "Cited listings are Kutch Bhujodi handloom cotton dupattas though sarees are priced higher." |
| Phulkari Embroidered Coasters, Set of 6 (₹1,990) | ₹8,000, **poor** | "The cited listings are Phulkari embroidered garments and dress materials rather than coasters…" |

The coaster case shows RAG's main limit: **generation can't fix bad retrieval.** The retriever
matched the craft word (Phulkari) and found garments. The LLM noticed and said so, but still
priced from them. Without retrieval, Gemini guessed ₹499; Ridge said ₹1,403.

## 5. In the advisor

The advisor page (`app/streamlit_app.py`) has an optional checkbox: "Also ask Gemini to explain the
price from the similar listings". It sends the advisor's own 10 retrieved listings, shows the
estimate, cited listings and reason, and warns when the match quality isn't "good". The
knowledge-based floor and the Ridge range stay the decision; RAG only explains.

Checked in the browser on the demo saree. Gemini cited listings 4–6 (handloom silk Pochampally
sarees with zari) and said why. It also gave a zero-width range (₹37,990 – ₹37,990), the
overconfidence measured above.

## Limitations

- 40 products: enough to show the retrieval effect (R² 0.34 → 0.73), not to rank RAG against Ridge.
- One run at temperature 0; other phrasings of the prompt could do better or worse.
- RAG costs an API call per product and depends on the free-tier quota.
