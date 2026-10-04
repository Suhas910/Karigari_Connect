"""Part 11 — similar-items search with a vector index (Unit V: embeddings, vector databases / FAISS,
retrieval as in RAG).

Each training product is a vector (TF-IDF -> SVD 100 dims, unit length) stored in a FAISS inner-product
index (inner product of unit vectors = cosine similarity). For a new product, retrieve the k most similar
training listings and report their price range: evidence a person can check, not a black-box number.
Evaluation on the frozen test set:
  - kNN-median as a price estimate (R2, MAE) for k = 1, 5, 10, 25
  - how often the true price lies inside the neighbours' 25th-75th percentile range
  - an 'evidence' table for a few example products
"""
import json, numpy as np, pandas as pd, faiss
from sklearn.metrics import r2_score, mean_absolute_error
from features import load, dense

tr, te, kgc = load()
_, _, Ttr, Tte = dense(tr, te, kgc)
index = faiss.IndexFlatIP(Ttr.shape[1])
index.add(np.ascontiguousarray(Ttr, dtype="float32"))
faiss.write_index(index, "tool_exports/faiss_train_index.bin")
sims, idx = index.search(np.ascontiguousarray(Tte, dtype="float32"), 25)
P = tr.price.values[idx]                     # neighbour prices, shape (n_test, 25)
y = te.price.values

out = {"index": "faiss.IndexFlatIP (exact search)", "vectors": int(index.ntotal), "dims": int(Ttr.shape[1]),
       "knn_price_estimate": {}}
for k in (1, 5, 10, 25):
    med = np.median(P[:, :k], axis=1)
    q25, q75 = np.percentile(P[:, :k], [25, 75], axis=1)
    out["knn_price_estimate"][k] = dict(r2=round(float(r2_score(y, med)), 4), mae=round(float(mean_absolute_error(y, med)), 1),
                                        iqr_coverage=round(float(((y >= q25) & (y <= q75)).mean()), 3) if k > 1 else None)
s10 = sims[:, :10].mean(1)
out["mean_similarity_top10"] = {"median": round(float(np.median(s10)), 3),
                                "p10": round(float(np.percentile(s10, 10)), 3), "p90": round(float(np.percentile(s10, 90)), 3)}
# Does retrieval quality predict error? (useful for the advisor: low similarity -> say "uncertain")
err = np.abs(np.median(P[:, :10], 1) - y) / y
q = pd.qcut(s10, 4, labels=["lowest", "low", "high", "highest"])
out["relative_error_by_similarity_quartile"] = {str(b): round(float(np.median(err[q == b])), 3) for b in q.categories}

ex_rows = []
for i in te.sample(3, random_state=11).index:
    ex_rows.append(dict(product=te.product_title.iat[i], price=int(y[i]),
                        neighbours=[dict(title=tr.product_title.iat[j], price=int(tr.price.iat[j]), similarity=round(float(s), 3))
                                    for j, s in zip(idx[i, :5], sims[i, :5])],
                        range_p25_p75=[float(np.percentile(P[i, :10], 25)), float(np.percentile(P[i, :10], 75))]))
out["examples"] = ex_rows
json.dump(out, open("reports/models/part11_similar_items.json", "w"), indent=1)
print(json.dumps({k: v for k, v in out.items() if k != "examples"}, indent=1))
for e in ex_rows:
    print(f"\nTEST: {e['product']}  ₹{e['price']}   neighbours' 25-75%: ₹{e['range_p25_p75'][0]:.0f}–{e['range_p25_p75'][1]:.0f}")
    for n in e["neighbours"]:
        print(f"   {n['similarity']:.2f}  ₹{n['price']:>6}  {n['title'][:70]}")
