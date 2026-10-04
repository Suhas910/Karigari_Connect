"""Score one experiment stage on the FROZEN test set and append the results to experiments.csv.

Usage: python scripts/evaluate_stage.py S0
Same reference models and metrics every stage, so changes in score come only from the stage's change.
Errors are always measured in rupees on the original price, even when a model trains on log(price).
"""
import sys, time, json
import numpy as np, pandas as pd
from sklearn.dummy import DummyRegressor
from sklearn.linear_model import LinearRegression, LogisticRegression, Ridge
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import make_pipeline
from sklearn.metrics import r2_score, mean_absolute_error, mean_absolute_percentage_error, f1_score

STAGE = sys.argv[1]
split = pd.read_csv("data/splits/split_assignment.csv", dtype=str).set_index("image_file").split

def load(path):
    d = pd.read_csv(path, dtype=str, keep_default_na=False)
    if "image_file" not in d:  # raw files: derive the row key the same way OpenRefine did
        d["image_file"] = d.image_paths.str.replace(r"[\[\]']", "", regex=True).str.replace("images/", "")
    d["price"] = pd.to_numeric(d.price)
    d["split"] = d.image_file.map(split).fillna("train")  # 16 raw rows dropped in S02 never reach test
    return d

# Stage definitions: data, categorical features, numeric features, log target?
RAW = [f"data/raw/handicraft/complete_venues_{i}.csv" for i in (1, 2, 3)]
STAGES = {
    "S0": dict(data=RAW, cat=["artform"], num=[], log=False,
               change="Raw data, price parsed only; raw artform text as one category"),
    "S1": dict(data="data/stages/S01_types.csv.gz", cat=["artform"], num=[], log=False,
               change="Types fixed (no feature change)"),
    "S2": dict(data="data/stages/S02_missing.csv.gz", cat=["artform"], num=[], log=False,
               change="16 rows with no art form removed"),
    "S4": dict(data="data/stages/S04_artform.csv.gz", cat=["primary_artform"], num=["artform_count"], log=False,
               change="Primary art form (D1) + spelling merges + rare -> other; label count"),
    "S5": dict(data="data/stages/S05_derived.csv.gz", cat=["primary_artform"], num=["artform_count"], log=True,
               change="log(price) target"),
    "S5b": dict(data="data/stages/S05_derived.csv.gz", cat=["primary_artform"],
                num=["artform_count", "title_len", "desc_len", "desc_repeat"], log=True,
                change="+ title/description length and description-repeat count"),
    "S6a": dict(data="data/stages/S06_zwsp_fix.csv.gz", cat=["primary_artform"], multi=["artform_all"],
                num=["artform_count", "title_len", "desc_len", "desc_repeat"], log=True,
                change="+ all art-form labels as multi-hot features"),
    "S6b": dict(data="data/stages/S06_zwsp_fix.csv.gz", cat=["primary_artform"], multi=["artform_all"],
                text=True, num=["artform_count", "title_len", "desc_len", "desc_repeat"], log=True,
                change="+ TF-IDF words of title + description (top 5,000 terms, 1-2 word phrases)"),
}
S6B = STAGES["S6b"]
STAGES["S7"] = dict(S6B, kg=True, change="S6b + knowledge-graph features (technique groups, materials, rule flags R1-R5)")
STAGES["S7-only"] = dict(STAGES["S6a"], kg=True, change="S6a + knowledge-graph features, no TF-IDF (isolates the KG gain)")
STAGES["S6c-z"] = dict(S6B, drop="z", change="S6b, training rows flagged by z-score > 3 on log price removed")
STAGES["S6c-iso"] = dict(S6B, drop="iso", change="S6b, training rows flagged by Isolation Forest (1%) removed")
STAGES["S8"] = dict(STAGES["S7"], seg=True, change="S7 + K-Means segment id (17 text segments, fitted on train)")
STAGES["S8-only"] = dict(STAGES["S7-only"], seg=True, change="S7-only + K-Means segment id (no TF-IDF)")
STAGES["S9"] = dict(STAGES["S8"], scale=True, change="S8 + numeric features standardised (mean 0, sd 1) before the models")
STAGES["S10"] = dict(STAGES["S9"], llm=True, change="S9 + LLM-extracted materials/handloom (part 12) + size and set size from titles")
STAGES["S10-swap"] = dict(STAGES["S9"], llm=True, drop_kw_mat=True,
                          change="S9 with keyword materials replaced by LLM materials, + title size features")
STAGES["S12"] = dict(STAGES["S10-swap"], tfidf_max=20000, tfidf_min_df=2,
                     change="S10-swap tuned by grouped CV (part 8b): TF-IDF 20,000 terms, min_df 2; Ridge alpha 1 kept")
STAGES["S12-img"] = dict(STAGES["S12"], img=True,
                         change="S12 + photo features: SqueezeNet CNN embeddings (Orange), PCA fitted on train (part 13)")
cfg = STAGES[STAGE]
cfg.setdefault("multi", []); cfg.setdefault("text", False)
d = pd.concat([load(p) for p in cfg["data"]]) if isinstance(cfg["data"], list) else load(cfg["data"])
for c in cfg["num"]:
    d[c] = pd.to_numeric(d[c])
tr, te = d[d.split == "train"], d[d.split == "test"]
if cfg.get("kg"):  # rule-derived features from scripts/build_kg.py (no prices involved)
    kg = pd.read_csv("data/features/kg_features.csv")
    kgc = [c for c in kg.columns if c != "image_file"]
    d = d.merge(kg, on="image_file", how="left")
    d[kgc] = d[kgc].astype(float)
    cfg = dict(cfg, num=cfg["num"] + kgc)
if cfg.get("llm"):  # part 12 LLM attributes + title regex size features (scripts/llm_features.py)
    lf = pd.read_csv("data/features/llm_features.csv")
    d = d.merge(lf, on="image_file", how="left")
    newc = [c for c in lf.columns if c not in ("image_file", "llm_found")]
    num = [c for c in cfg["num"] if not (cfg.get("drop_kw_mat") and c.startswith("kg_mat_"))]
    cfg = dict(cfg, num=num + newc)
if cfg.get("img"):  # part 13: CNN photo embeddings, PCA fitted on training rows; components chosen by grouped CV
    k = json.load(open("reports/models/part13_images.json"))["s12_plus_images_cv"]["chosen_components"]
    imgc = [f"img_pc{i + 1}" for i in range(k)]
    d = d.merge(pd.read_csv("data/features/image_pca.csv.gz", usecols=["image_file"] + imgc), on="image_file", how="left")
    cfg = dict(cfg, num=cfg["num"] + imgc)
if cfg.get("seg"):
    d = d.merge(pd.read_csv("data/features/segment_features.csv"), on="image_file", how="left")
    d["segment"] = "seg" + d.segment.astype(str)
    cfg = dict(cfg, cat=cfg["cat"] + ["segment"])
if cfg.get("drop"):  # outlier handling: training rows only, the test set is never touched
    flags = pd.read_csv("data/splits/train_outlier_flags.csv").set_index("image_file")[cfg["drop"]]
    d = d[~(d.image_file.map(flags).fillna(False).astype(bool) & (d.split == "train"))]
d["text"] = d.product_title + " " + d.product_description if cfg["text"] else ""
tr, te = d[d.split == "train"], d[d.split == "test"]
X = cfg["cat"] + cfg["num"] + cfg["multi"] + (["text"] if cfg["text"] else [])
ytr = np.log(tr.price) if cfg["log"] else tr.price
back = np.exp if cfg["log"] else (lambda v: v)

parts = [("cat", OneHotEncoder(handle_unknown="ignore"), cfg["cat"])]
for c in cfg["multi"]:  # one 0/1 column per art-form label, learned from training rows only
    parts.append((c, CountVectorizer(tokenizer=lambda t: t.split(" | "), token_pattern=None,
                                     lowercase=False, binary=True), c))
if cfg["text"]:         # vocabulary and IDF weights learned from training rows only
    parts.append(("text", TfidfVectorizer(max_features=cfg.get("tfidf_max", 5000), ngram_range=(1, 2), min_df=cfg.get("tfidf_min_df", 5),
                                          sublinear_tf=True, stop_words="english"), "text"))
if cfg.get("scale"):  # standardise numeric columns so Ridge's penalty treats them evenly with the text features
    from sklearn.preprocessing import StandardScaler
    parts.append(("num", StandardScaler(), cfg["num"]))
pre = ColumnTransformer(parts, remainder="passthrough")
models = {
    "Median baseline": DummyRegressor(strategy="median"),
    "Median per art form": None,  # computed directly below
    "Linear Regression": make_pipeline(pre, LinearRegression()),
    "Ridge (alpha=1)": make_pipeline(pre, Ridge(alpha=1.0)),
    "Random Forest": make_pipeline(pre, RandomForestRegressor(n_estimators=200, min_samples_leaf=2,
                                                              n_jobs=4, random_state=42)),
}
rows = []
for name, m in models.items():
    t = time.time()
    if m is None:
        med = tr.groupby(cfg["cat"][0]).price.median()
        pred = te[cfg["cat"][0]].map(med).fillna(tr.price.median()).values
    else:
        m.fit(tr[X], ytr)
        pred = back(m.predict(te[X]))
    rows.append(dict(stage=STAGE, change=cfg["change"], train_rows=len(tr), test_rows=len(te),
                     features=len(X), model=name, r2=round(r2_score(te.price, pred), 4),
                     mae=round(mean_absolute_error(te.price, pred), 1),
                     mape=round(100 * mean_absolute_percentage_error(te.price, pred), 1),
                     seconds=round(time.time() - t, 1)))

# Price-band classification (low / mid / high by training-set tertiles), logistic regression
cuts = tr.price.quantile([1 / 3, 2 / 3]).values
band = lambda p: np.digitize(p, cuts)
clf = make_pipeline(pre, LogisticRegression(max_iter=5000))
clf.fit(tr[X], band(tr.price))
f1 = f1_score(band(te.price), clf.predict(te[X]), average="macro")
rows.append(dict(stage=STAGE, change=cfg["change"], train_rows=len(tr), test_rows=len(te), features=len(X),
                 model="Logistic Regression (price band)", f1_macro=round(f1, 4)))

out = pd.DataFrame(rows)
path = "reports/models/experiments.csv"
try:
    old = pd.read_csv(path)
    old = old[old.stage != STAGE]
    out = pd.concat([old, out])
except FileNotFoundError:
    pass
out.to_csv(path, index=False)
print(pd.DataFrame(rows).drop(columns=["change"]).to_string(index=False))
