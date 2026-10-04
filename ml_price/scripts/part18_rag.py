"""Part 18 — RAG evaluation (Unit V: retrieval-augmented generation, vector databases, LLMs).

40 test products, one per product family (seed 42), so no product line is counted twice.
Retriever: the better representation from part 17 (MiniLM or LSA), FAISS exact search over the
29,805 TRAINING listings, 10 neighbours. The test product's own price is never sent.

Compared on the same 40 products:
  RAG (LLM + retrieved listings) · LLM without retrieval · FAISS neighbour median · best Ridge (S12-img)
Also checked: range coverage, and grounding (cited numbers exist in the evidence; estimate inside the
evidence's price span). Gemini Flash-Lite, 5 products per request, at most 12 requests per minute.
Outputs: reports/llm/part18_rag.json, part18_rag_answers.csv.
"""
import sys, json, time, numpy as np, pandas as pd, faiss
sys.path.insert(0, "app")
import rag
from sklearn.metrics import r2_score, mean_absolute_error

d = pd.read_csv("data/final/handicraft_clean.csv.gz", keep_default_na=False)
sa = pd.read_csv("data/splits/split_assignment.csv").set_index("image_file")
d["split"], d["family"] = d.image_file.map(sa.split), d.image_file.map(sa.family)
tr_m = (d.split == "train").values
tr, te = d[tr_m].reset_index(drop=True), d[~tr_m].reset_index(drop=True)

p17 = json.load(open("reports/models/part17_sentence.json"))["retrieval_10nn"]
use_minilm = p17["MiniLM transformer (384)"]["r2"] >= p17["LSA (TF-IDF + SVD 100, part 11)"]["r2"]
if use_minilm:
    E = np.load("data/features/sentence_emb_minilm.npy"); Xtr, Xte = E[tr_m], E[~tr_m]; retriever = "MiniLM"
else:
    from features import load, dense
    ftr, fte, kgc = load(); _, _, Xtr, Xte = dense(ftr, fte, kgc); retriever = "LSA"
    assert (ftr.image_file.values == tr.image_file.values).all() and (fte.image_file.values == te.image_file.values).all()
idx = faiss.IndexFlatIP(Xtr.shape[1]); idx.add(np.ascontiguousarray(Xtr, dtype=np.float32))

sample = te.groupby("family").sample(1, random_state=42).sample(40, random_state=42)
sims, nn = idx.search(np.ascontiguousarray(Xte[sample.index.values], dtype=np.float32), 10)
products = [dict(title=r.product_title, description=r.product_description,
                 neighbours=[dict(title=tr.product_title[j], price=int(tr.price[j])) for j in nn[k]])
            for k, r in enumerate(sample.itertuples())]

def run(with_evidence, batch=5, rpm=12):
    outs, last = [], 0.0
    for i in range(0, len(products), batch):
        time.sleep(max(0, 60 / rpm - (time.time() - last))); last = time.time()
        for attempt in range(4):
            try:
                outs += rag.estimate(products[i:i + batch], with_evidence); break
            except Exception as e:                      # never print the key; only the error type
                print(f"  batch {i // batch}: {type(e).__name__}, retry", flush=True); time.sleep(20 * (attempt + 1))
        else:
            outs += [None] * len(products[i:i + batch])
    return outs

rag_out, plain_out = run(True), run(False)
y = sample.price.values
ridge = pd.read_csv("reports/models/part15_rows_final.csv").set_index("image_file").pred.reindex(sample.image_file).values
nb_median = np.array([np.median([n["price"] for n in p["neighbours"]]) for p in products])

def score(name, est, lo=None, hi=None):
    ok = ~np.isnan(est)
    r = dict(answered=int(ok.sum()), r2=round(r2_score(y[ok], est[ok]), 3), mae=round(mean_absolute_error(y[ok], est[ok]), 1),
             median_ape=round(float(np.median(np.abs(est[ok] - y[ok]) / y[ok])) * 100, 1))
    if lo is not None:
        r["range_coverage"] = round(float(((y >= lo) & (y <= hi))[ok].mean()), 3)
        r["median_range_width_ratio"] = round(float(np.median(((hi - lo) / est)[ok])), 2)
    return r
g = lambda outs, k: np.array([o[k] if o else np.nan for o in outs], dtype=float)
res = {"retriever": retriever, "products": len(sample), "model": rag.MODEL,
       "RAG (LLM + 10 retrieved listings)": score("rag", g(rag_out, "estimate"), g(rag_out, "low"), g(rag_out, "high")),
       "LLM without retrieval": score("plain", g(plain_out, "estimate"), g(plain_out, "low"), g(plain_out, "high")),
       "FAISS neighbour median (no LLM)": score("nb", nb_median),
       "Ridge S12-img (best model)": score("ridge", ridge)}

# Grounding checks on the RAG answers
cited_ok, inside, quality = [], [], []
for o, p in zip(rag_out, products):
    if not o:
        continue
    prices = [n["price"] for n in p["neighbours"]]
    cited_ok.append(all(1 <= c <= 10 for c in o["cited"]) and len(o["cited"]) > 0)
    inside.append(min(prices) <= o["estimate"] <= max(prices))
    quality.append(o["match_quality"])
res["grounding"] = dict(citations_valid=round(float(np.mean(cited_ok)), 3), estimate_inside_evidence_span=round(float(np.mean(inside)), 3),
                        match_quality_counts=pd.Series(quality).value_counts().to_dict())
q = pd.Series([o["match_quality"] if o else None for o in rag_out])
ape = np.abs(g(rag_out, "estimate") - y) / y
res["rag_error_by_match_quality"] = {k: dict(n=int((q == k).sum()), median_ape=round(float(np.nanmedian(ape[q == k])) * 100, 1))
                                     for k in ["good", "partial", "poor"] if (q == k).any()}
json.dump(res, open("reports/llm/part18_rag.json", "w"), indent=1, ensure_ascii=False)
pd.DataFrame({"title": sample.product_title.values, "price": y, "ridge": ridge.round(0), "neighbour_median": nb_median,
              "rag_estimate": g(rag_out, "estimate"), "rag_low": g(rag_out, "low"), "rag_high": g(rag_out, "high"),
              "rag_cited": [o["cited"] if o else None for o in rag_out], "rag_quality": q.values,
              "rag_reason": [o["reason"] if o else None for o in rag_out],
              "plain_estimate": g(plain_out, "estimate"), "plain_reason": [o["reason"] if o else None for o in plain_out]}
             ).to_csv("reports/llm/part18_rag_answers.csv", index=False)
print(json.dumps(res, indent=1, ensure_ascii=False))
