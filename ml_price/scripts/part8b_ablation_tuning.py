"""Part 8b — ablation and final tuning of the best model (S10-swap features, Ridge on log price).

Ablation: remove ONE feature group at a time from the full S10-swap set and re-score Ridge (alpha=1,
the stage-harness setting). Scored twice: grouped 5-fold CV on training rows (out-of-fold
predictions, groups = product family) and the frozen test set. The CV numbers are the ones to read
for "which groups matter"; the test numbers are shown only to confirm they agree.

Tuning: GridSearchCV over Ridge alpha and the TF-IDF vocabulary, grouped 5-fold CV on training
rows only, scored by MAE on log price. The chosen setting is then scored ONCE on the test set.
n_jobs=4 (memory cap). Outputs: reports/models/part8b_ablation.csv, part8b_tuning.csv/json.
"""
import json, time, numpy as np, pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.linear_model import Ridge
from sklearn.model_selection import GroupKFold, GridSearchCV, cross_val_predict
from sklearn.metrics import r2_score, mean_absolute_error, mean_absolute_percentage_error

N = 4
sa = pd.read_csv("data/splits/split_assignment.csv").set_index("image_file")
d = pd.read_csv("data/stages/S06_zwsp_fix.csv.gz", keep_default_na=False)
d["split"], d["family"] = d.image_file.map(sa.split), d.image_file.map(sa.family)
kg = pd.read_csv("data/features/kg_features.csv")
kg = kg[[c for c in kg.columns if not c.startswith("kg_mat_")]]          # S10-swap: keyword materials dropped
lf = pd.read_csv("data/features/llm_features.csv").drop(columns="llm_found")
seg = pd.read_csv("data/features/segment_features.csv")
d = d.merge(kg, on="image_file").merge(lf, on="image_file").merge(seg, on="image_file")
d["segment"] = "seg" + d.segment.astype(str)
d["text"] = d.product_title + " " + d.product_description
for c in ["artform_count", "title_len", "desc_len", "desc_repeat"]:
    d[c] = pd.to_numeric(d[c])

GROUPS = {   # name -> (kind, columns)
    "primary art form (one-hot)": ("cat", ["primary_artform"]),
    "all art-form labels (multi-hot)": ("multi", "artform_all"),
    "TF-IDF text": ("text", "text"),
    "lengths + repeat count": ("num", ["artform_count", "title_len", "desc_len", "desc_repeat"]),
    "knowledge-graph rules (techniques, skill)": ("num", [c for c in kg.columns if c != "image_file"]),
    "LLM materials + handloom": ("num", [c for c in lf.columns if c.startswith("llm_")]),
    "title size + set size": ("num", [c for c in lf.columns if c.startswith(("title_", "log_title"))]),
    "K-Means segment": ("cat", ["segment"]),
}

def make_pre(groups, max_features=5000, min_df=5, ngram=(1, 2)):
    parts, num = [], []
    for name in groups:
        kind, cols = GROUPS[name]
        if kind == "cat":
            parts.append((name, OneHotEncoder(handle_unknown="ignore"), cols))
        elif kind == "multi":
            parts.append((name, CountVectorizer(tokenizer=lambda t: t.split(" | "), token_pattern=None,
                                                lowercase=False, binary=True), cols))
        elif kind == "text":
            parts.append((name, TfidfVectorizer(max_features=max_features, ngram_range=ngram, min_df=min_df,
                                                sublinear_tf=True, stop_words="english"), cols))
        else:
            num += cols
    if num:
        parts.append(("num", StandardScaler(), num))
    return ColumnTransformer(parts)

tr, te = d[d.split == "train"].reset_index(drop=True), d[d.split == "test"].reset_index(drop=True)
ytr = np.log(tr.price.values)
cv = list(GroupKFold(5).split(tr, groups=tr.family))
def scores(y, p):
    return dict(r2=round(r2_score(y, p), 4), mae=round(mean_absolute_error(y, p), 1),
                mape=round(100 * mean_absolute_percentage_error(y, p), 1))

# --- ablation ---------------------------------------------------------------------------------------
rows = []
for drop in [None] + list(GROUPS):
    t = time.time()
    keep = [g for g in GROUPS if g != drop]
    m = Pipeline([("pre", make_pre(keep)), ("ridge", Ridge(alpha=1.0))])
    oof = np.exp(cross_val_predict(m, tr, ytr, cv=cv, n_jobs=N))
    test = np.exp(m.fit(tr, ytr).predict(te))
    r = dict(removed=drop or "(nothing: full S10-swap)", **{f"cv_{k}": v for k, v in scores(tr.price, oof).items()},
             **{f"test_{k}": v for k, v in scores(te.price, test).items()}, seconds=round(time.time() - t, 1))
    rows.append(r); print(r, flush=True)
ab = pd.DataFrame(rows)
for s in ["cv", "test"]:
    ab[f"{s}_r2_change"] = (ab[f"{s}_r2"] - ab[f"{s}_r2"].iloc[0]).round(4)
ab.to_csv("reports/models/part8b_ablation.csv", index=False)

# --- tuning -----------------------------------------------------------------------------------------
pipe = Pipeline([("pre", make_pre(list(GROUPS))), ("ridge", Ridge())])
grid = {"ridge__alpha": [0.3, 1, 3, 10],
        "pre__TF-IDF text__max_features": [5000, 20000, 50000],
        "pre__TF-IDF text__min_df": [2, 5]}
t = time.time()
gs = GridSearchCV(pipe, grid, scoring="neg_mean_absolute_error", cv=cv, n_jobs=N).fit(tr, ytr)
res = pd.DataFrame(gs.cv_results_)[["params", "mean_test_score", "std_test_score", "rank_test_score"]]
res["cv_mae_log"] = (-res.mean_test_score).round(4); res = res.drop(columns="mean_test_score").sort_values("rank_test_score")
res.to_csv("reports/models/part8b_tuning.csv", index=False)
best = gs.best_estimator_
test = np.exp(best.predict(te))
default = dict(rows[0])
out = dict(best_params={k: (v if not isinstance(v, np.generic) else v.item()) for k, v in gs.best_params_.items()},
           best_cv_mae_log=round(-gs.best_score_, 4),
           default_cv_mae_log=float(res[res.params.map(lambda p: p["ridge__alpha"] == 1 and p["pre__TF-IDF text__max_features"] == 5000
                                                         and p["pre__TF-IDF text__min_df"] == 5)].cv_mae_log.iloc[0]),
           test_tuned=scores(te.price, test),
           test_default=dict(r2=default["test_r2"], mae=default["test_mae"], mape=default["test_mape"]),
           seconds=round(time.time() - t, 1))
# Price-band F1 for the tuned model: predicted price mapped to the training tertiles
from sklearn.metrics import f1_score
cuts = tr.price.quantile([1 / 3, 2 / 3]).values
out["test_tuned"]["band_f1_from_regression"] = round(f1_score(np.digitize(te.price, cuts), np.digitize(test, cuts), average="macro"), 4)
pd.DataFrame({"image_file": te.image_file, "price": te.price, "pred_tuned": test.round(1)}).to_csv(
    "reports/models/part8b_test_predictions.csv", index=False)
json.dump(out, open("reports/models/part8b_tuning.json", "w"), indent=1, default=str)
print(ab.drop(columns="seconds").to_string(index=False))
print(res.head(8).to_string(index=False))
print(json.dumps(out, indent=1, default=str))
