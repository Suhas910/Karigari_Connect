"""Part 16, step 1 — train and save everything the price advisor needs (training split only).

Saves models/advisor.joblib (Ridge pipeline, 80% band, retrieval vectoriser, thresholds, bias table)
and models/advisor_faiss.bin (similar-items index).
"""
import json, joblib, numpy as np, pandas as pd, faiss
from sklearn.model_selection import GroupKFold
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler, normalize
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer
from sklearn.decomposition import TruncatedSVD
from features import load, NUM

tr, te, kgc = load()
y = np.log(tr.price.values)
COLS = ["primary_artform", "segment", "artform_all", "text"] + NUM + kgc

def ridge_pipeline():
    ct = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore"), ["primary_artform", "segment"]),
        ("lab", CountVectorizer(tokenizer=str.split, token_pattern=None, lowercase=False, binary=True), "artform_all"),
        ("txt", TfidfVectorizer(max_features=5000, ngram_range=(1, 2), min_df=5, sublinear_tf=True, stop_words="english"), "text"),
        ("num", StandardScaler(), NUM + kgc)])
    return make_pipeline(ct, Ridge(alpha=3))
# labels are joined with "|" and no spaces inside a token, so a plain whitespace split works and pickles cleanly
enc = lambda s: " ".join(x.strip().replace(" ", "_") for x in s.split(" | "))
X = tr.assign(artform_all=tr.artform_all.map(enc))[COLS]

oof = np.zeros(len(tr))
for a, b in GroupKFold(5).split(X, groups=tr.family):
    oof[b] = ridge_pipeline().fit(X.iloc[a], y[a]).predict(X.iloc[b])
band = np.percentile(y - oof, [10, 90])
model = ridge_pipeline().fit(X, y)

# retrieval: TF-IDF -> SVD -> unit vectors, FAISS inner product (= cosine)
tf = TfidfVectorizer(max_features=20000, min_df=5, sublinear_tf=True, stop_words="english")
svd = TruncatedSVD(n_components=100, random_state=42)
V = normalize(svd.fit_transform(tf.fit_transform(tr.text))).astype("float32")
index = faiss.IndexFlatIP(V.shape[1]); index.add(V)
# caution threshold: 25th percentile of mean top-10 similarity when a training product queries the index
# with its own family removed (so it behaves like a genuinely new product)
rng = np.random.RandomState(42); S = rng.choice(len(tr), 3000, replace=False)
sims, idx = index.search(V[S], 1000)   # deep enough to get past large families (up to 629 rows)
fam = tr.family.values
m10 = [s[fam[i] != fam[S[k]]][:10] for k, (s, i) in enumerate(zip(sims, idx))]
m10 = [m.mean() for m in m10 if len(m) == 10]
low_sim = float(np.percentile(m10, 25))

# segment assignment for new products: the K-Means from part 5 is refitted here identically
from sklearn.cluster import KMeans
seg_tf = TfidfVectorizer(max_features=20000, min_df=5, sublinear_tf=True, stop_words="english")
seg_svd = TruncatedSVD(n_components=100, random_state=42)
seg_X = normalize(seg_svd.fit_transform(seg_tf.fit_transform(tr.text)))
km = KMeans(17, n_init=10, random_state=42).fit(seg_X)
assert (("seg" + pd.Series(km.labels_).astype(str)).values == tr.segment.values).mean() > 0.99

# Family-level audit (one row per product family, >= 5 test families per art form): a product line listed
# in hundreds of colours would otherwise decide an art form's result on its own (part 15 revision).
bias = json.load(open("reports/models/part15_bias.json"))["primary_artform_family_level"]
bias = {r["primary_artform"]: (r["median_ratio"], r["families"]) for r in bias}

joblib.dump(dict(model=model, band=band.tolist(), cols=COLS, kgc=kgc, retr_tf=tf, retr_svd=svd,
                 seg=(seg_tf, seg_svd, km), low_sim=low_sim, bias=bias,
                 train_titles=tr.product_title.tolist(), train_prices=tr.price.tolist(),
                 labels=sorted({x for s in tr.artform_all for x in s.split(" | ")}),
                 primary_values=sorted(tr.primary_artform.unique())),
            "models/advisor.joblib", compress=3)
faiss.write_index(index, "models/advisor_faiss.bin")
print(dict(threshold_sample=len(m10), band_log=[round(b, 3) for b in band], band_multipliers=[round(float(np.exp(b)), 3) for b in band],
           low_similarity_threshold=round(low_sim, 3), segments_match=True))
