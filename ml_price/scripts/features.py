"""Shared feature building for parts 9-11 (everything fitted on the training split only).

load()   -> train/test DataFrames with KG features, segment id and a combined text column
sparse() -> S8 feature set as a sparse matrix (one-hot, multi-hot labels, TF-IDF, numeric)
dense()  -> compact dense version: text compressed by TruncatedSVD to 100 dims + KG + numeric + segment one-hot
"""
import numpy as np, pandas as pd, scipy.sparse as sp
from sklearn.preprocessing import OneHotEncoder, StandardScaler, normalize
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer
from sklearn.decomposition import TruncatedSVD

def load():
    kg = pd.read_csv("data/features/kg_features.csv")
    seg = pd.read_csv("data/features/segment_features.csv")
    fam = pd.read_csv("data/splits/split_assignment.csv").set_index("image_file").family
    out = []
    for n in ("train", "test"):
        x = pd.read_csv(f"data/splits/{n}.csv", keep_default_na=False).merge(kg, on="image_file").merge(seg, on="image_file")
        x["segment"] = "seg" + x.segment.astype(str)
        x["text"] = x.product_title + " " + x.product_description
        x["family"] = x.image_file.map(fam)
        out.append(x)
    kgc = [c for c in kg.columns if c != "image_file"]
    for x in out:
        x[kgc] = x[kgc].astype(float)
    return out[0], out[1], kgc

NUM = ["artform_count", "title_len", "desc_len", "desc_repeat"]

def sparse(tr, te, kgc, return_names=False):
    ct = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore"), ["primary_artform", "segment"]),
        ("lab", CountVectorizer(tokenizer=lambda t: t.split(" | "), token_pattern=None, lowercase=False, binary=True), "artform_all"),
        ("txt", TfidfVectorizer(max_features=5000, ngram_range=(1, 2), min_df=5, sublinear_tf=True, stop_words="english"), "text"),
        ("num", StandardScaler(), NUM + kgc),
    ])
    A, B = ct.fit_transform(tr).tocsr(), ct.transform(te).tocsr()
    return (A, B, list(ct.get_feature_names_out())) if return_names else (A, B)

def dense(tr, te, kgc, n_svd=100):
    tf = TfidfVectorizer(max_features=20000, min_df=5, sublinear_tf=True, stop_words="english")
    svd = TruncatedSVD(n_components=n_svd, random_state=42)
    Ttr = normalize(svd.fit_transform(tf.fit_transform(tr.text)))
    Tte = normalize(svd.transform(tf.transform(te.text)))
    oh = OneHotEncoder(handle_unknown="ignore", sparse_output=False).fit(tr[["segment"]])
    sc = StandardScaler().fit(tr[NUM])
    f = lambda x, T: np.hstack([T, x[kgc].values, sc.transform(x[NUM]), oh.transform(x[["segment"]])])
    return f(tr, Ttr), f(te, Tte), Ttr, Tte
