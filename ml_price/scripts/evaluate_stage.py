"""Score one experiment stage on the FROZEN test set and append the results to experiments.csv.

Usage: python scripts/evaluate_stage.py S0
Same reference models and metrics every stage, so changes in score come only from the stage's change.
Errors are always measured in rupees on the original price, even when a model trains on log(price).
"""
import sys, time, json
import numpy as np, pandas as pd
from sklearn.dummy import DummyRegressor
from sklearn.linear_model import LinearRegression, LogisticRegression
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
}
cfg = STAGES[STAGE]
d = pd.concat([load(p) for p in cfg["data"]]) if isinstance(cfg["data"], list) else load(cfg["data"])
for c in cfg["num"]:
    d[c] = pd.to_numeric(d[c])
tr, te = d[d.split == "train"], d[d.split == "test"]
X = cfg["cat"] + cfg["num"]
ytr = np.log(tr.price) if cfg["log"] else tr.price
back = np.exp if cfg["log"] else (lambda v: v)

pre = ColumnTransformer([("cat", OneHotEncoder(handle_unknown="ignore", min_frequency=1), cfg["cat"])],
                        remainder="passthrough")
models = {
    "Median baseline": DummyRegressor(strategy="median"),
    "Median per art form": None,  # computed directly below
    "Linear Regression": make_pipeline(pre, LinearRegression()),
    "Random Forest": make_pipeline(pre, RandomForestRegressor(n_estimators=200, min_samples_leaf=2,
                                                              n_jobs=-1, random_state=42)),
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
clf = make_pipeline(pre, LogisticRegression(max_iter=2000))
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
