"""Part 5 — market segmentation (Unit IV: distances, K-Means, Hierarchical, DBSCAN, PCA).

Representation: TF-IDF of title + description -> TruncatedSVD (100 dims, i.e. LSA) -> L2-normalised,
so Euclidean distance between rows equals sqrt(2 - 2*cosine similarity).
Everything is fitted on the TRAINING split; test rows are only assigned to the nearest K-Means centre.
Outputs: reports/unsupervised/segmentation.json, figures/P5_*.png, data/features/segment_features.csv
"""
import json, numpy as np, pandas as pd, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.decomposition import TruncatedSVD, PCA
from sklearn.preprocessing import normalize
from sklearn.cluster import KMeans, AgglomerativeClustering, DBSCAN
from sklearn.metrics import silhouette_score, pairwise_distances
from sklearn.neighbors import NearestNeighbors

tr = pd.read_csv("data/splits/train.csv", keep_default_na=False)
te = pd.read_csv("data/splits/test.csv", keep_default_na=False)
txt = lambda x: x.product_title + " " + x.product_description
tfidf = TfidfVectorizer(max_features=20000, min_df=5, sublinear_tf=True, stop_words="english")
svd = TruncatedSVD(n_components=100, random_state=42)
Xtr = normalize(svd.fit_transform(tfidf.fit_transform(txt(tr))))
Xte = normalize(svd.transform(tfidf.transform(txt(te))))
rng = np.random.RandomState(42)
S = rng.choice(len(tr), 5000, replace=False)          # sample for silhouette / hierarchical / DBSCAN
out = {"svd_explained_variance": round(float(svd.explained_variance_ratio_.sum()), 3)}

def dist_stats(X, lab):
    """Mean intra-cluster distance (to own centroid) and mean inter-centroid distance."""
    ks = [k for k in np.unique(lab) if k != -1]
    cents = np.array([X[lab == k].mean(0) for k in ks])
    intra = np.mean([np.linalg.norm(X[lab == k] - c, axis=1).mean() for k, c in zip(ks, cents)])
    inter = pairwise_distances(cents)[np.triu_indices(len(ks), 1)].mean()
    return round(float(intra), 3), round(float(inter), 3)

# K-Means: choose k by silhouette (also record inertia for the elbow plot)
km_scan = []
for k in range(2, 21):
    km = KMeans(k, n_init=10, random_state=42).fit(Xtr)
    km_scan.append(dict(k=k, inertia=round(float(km.inertia_), 1),
                        silhouette=round(float(silhouette_score(Xtr[S], km.labels_[S])), 4)))
best_k = max(km_scan, key=lambda r: r["silhouette"])["k"]
km = KMeans(best_k, n_init=10, random_state=42).fit(Xtr)
out["kmeans_scan"] = km_scan
out["kmeans"] = dict(k=best_k, silhouette=max(r["silhouette"] for r in km_scan),
                     intra_inter=dist_stats(Xtr, km.labels_))

# Hierarchical (Ward) on the sample, same k
hc = AgglomerativeClustering(n_clusters=best_k, linkage="ward").fit(Xtr[S])
out["hierarchical"] = dict(k=best_k, silhouette=round(float(silhouette_score(Xtr[S], hc.labels_)), 4),
                           intra_inter=dist_stats(Xtr[S], hc.labels_))

# DBSCAN on the sample; eps from the k-distance curve (90th percentile of 10th-neighbour distance)
kd = np.sort(NearestNeighbors(n_neighbors=10).fit(Xtr[S]).kneighbors(Xtr[S])[0][:, -1])
db_runs = []
for q in [50, 70, 90]:
    eps = float(np.percentile(kd, q))
    lab = DBSCAN(eps=eps, min_samples=10).fit_predict(Xtr[S])
    n_cl, noise = len(set(lab) - {-1}), float((lab == -1).mean())
    sil = float(silhouette_score(Xtr[S][lab != -1], lab[lab != -1])) if n_cl > 1 else None
    db_runs.append(dict(eps_percentile=q, eps=round(eps, 3), clusters=n_cl, noise_share=round(noise, 3),
                        silhouette_non_noise=None if sil is None else round(sil, 4)))
out["dbscan"] = db_runs

# Distance-measure comparison on the sample (Unit IV): how often do the metrics agree on the nearest neighbour?
nn = {m: NearestNeighbors(n_neighbors=2, metric=m).fit(Xtr[S]).kneighbors(Xtr[S])[1][:, 1]
      for m in ["euclidean", "manhattan", "cosine"]}
out["nearest_neighbour_agreement"] = {f"{a}_vs_{b}": round(float((nn[a] == nn[b]).mean()), 3)
                                      for a, b in [("euclidean", "cosine"), ("euclidean", "manhattan"),
                                                   ("manhattan", "cosine")]}

# Segment profiles (training rows)
terms = np.array(tfidf.get_feature_names_out())
centres_tfidf = svd.inverse_transform(km.cluster_centers_)
prof = []
for k in range(best_k):
    m = km.labels_ == k
    top_af = tr.primary_artform[m].value_counts().head(3)
    prof.append(dict(segment=k, rows=int(m.sum()), share=round(float(m.mean()), 3),
                     median_price=float(tr.price[m].median()),
                     top_terms=list(terms[np.argsort(centres_tfidf[k])[::-1][:8]]),
                     top_artforms={a: int(n) for a, n in top_af.items()}))
out["segments"] = sorted(prof, key=lambda r: r["median_price"])
json.dump(out, open("reports/unsupervised/segmentation.json", "w"), indent=1)

# Features: segment id for every row (test rows assigned to nearest centre)
pd.concat([pd.DataFrame({"image_file": tr.image_file, "segment": km.labels_}),
           pd.DataFrame({"image_file": te.image_file, "segment": km.predict(Xte)})]
          ).to_csv("data/features/segment_features.csv", index=False)

# Figures
fig, ax = plt.subplots(1, 2, figsize=(11, 4))
ks = [r["k"] for r in km_scan]
ax[0].plot(ks, [r["inertia"] for r in km_scan], marker="o"); ax[0].set_title("K-Means elbow (inertia)")
ax[1].plot(ks, [r["silhouette"] for r in km_scan], marker="o", color="tab:green")
ax[1].axvline(best_k, ls="--", color="grey"); ax[1].set_title(f"Silhouette (best k = {best_k})")
for a in ax: a.set_xlabel("k"); a.grid(alpha=.3)
plt.tight_layout(); plt.savefig("figures/P5_kmeans_k_selection.png", dpi=140); plt.close()

p2 = PCA(n_components=2, random_state=42).fit(Xtr)
Z = p2.transform(Xtr[S])
plt.figure(figsize=(7, 6))
sc = plt.scatter(Z[:, 0], Z[:, 1], c=km.labels_[S], cmap="tab20", s=4, alpha=.6)
for k, c in enumerate(p2.transform(km.cluster_centers_)):
    plt.text(c[0], c[1], str(k), fontsize=9, weight="bold", ha="center")
plt.title(f"PCA map of 5,000 training products, coloured by K-Means segment\n"
          f"(PC1+PC2 explain {p2.explained_variance_ratio_.sum():.1%} of variance)")
plt.xlabel("PC1"); plt.ylabel("PC2"); plt.tight_layout(); plt.savefig("figures/P5_pca_segments.png", dpi=140)
print(json.dumps({k: v for k, v in out.items() if k not in ("kmeans_scan", "segments")}, indent=1))
for r in out["segments"]:
    print(r["segment"], r["rows"], r["median_price"], r["top_terms"][:6], list(r["top_artforms"])[:2])
