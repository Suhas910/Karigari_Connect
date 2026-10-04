"""Part 14 — explainability with SHAP (Unit V: explainable AI).

A. Ridge on S9 features (the best regression model, alpha=3 from part 8).
   For a linear model with independent features, SHAP value = coef * (x - mean of training x); computed
   for all test rows and checked against shap.LinearExplainer on a sample.
B. Gradient boosting on readable features only (KG + lengths + segment, no text SVD), explained with
   shap.TreeExplainer, so the plot shows nameable features.
Effects are on log(price): a SHAP value of +0.1 means about x1.105 (+10.5%) on the predicted price.
"""
import json, numpy as np, pandas as pd, scipy.sparse as sp, matplotlib, shap
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.linear_model import Ridge
from sklearn.ensemble import HistGradientBoostingRegressor
from features import load, sparse, NUM

tr, te, kgc = load()
ytr = np.log(tr.price.values)
Str, Ste, names = sparse(tr, te, kgc, return_names=True)
names = np.array([n.replace("txt__", "word: ").replace("lab__", "label: ").replace("cat__primary_artform_", "primary: ")
                  .replace("cat__segment_", "segment: ").replace("num__kg_", "KG: ").replace("num__", "") for n in names])
group = np.array(["words (TF-IDF)" if n.startswith("word: ") else "art-form labels" if n.startswith("label: ")
                  else "primary art form" if n.startswith("primary: ") else "segment" if n.startswith("segment: ")
                  else "knowledge graph" if n.startswith("KG: ") else "lengths / counts" for n in names])
ridge = Ridge(alpha=3).fit(Str, ytr)
mu = np.asarray(Str.mean(axis=0)).ravel()
SV = (Ste.toarray() - mu) * ridge.coef_                       # SHAP values, test rows x features

# check against the shap library on 200 rows
expl = shap.LinearExplainer(ridge, shap.maskers.Independent(Str[:2000].toarray(), max_samples=2000))
idx = np.random.RandomState(0).choice(Ste.shape[0], 200, replace=False)
lib = expl.shap_values(Ste[idx].toarray())
mu2 = Str[:2000].toarray().mean(0)
mine2 = (Ste[idx].toarray() - mu2) * ridge.coef_
check = float(np.abs(lib - mine2).max())

imp = np.abs(SV).mean(0)
top = np.argsort(imp)[::-1][:25]
grp = pd.Series(imp, index=group).groupby(level=0).sum().sort_values(ascending=False)
up = [(names[i], round(float(ridge.coef_[i]), 3)) for i in np.argsort(ridge.coef_)[::-1][:15]]
down = [(names[i], round(float(ridge.coef_[i]), 3)) for i in np.argsort(ridge.coef_)[:15]]

def explain_row(i, k=6):
    contrib = SV[i]; order = np.argsort(np.abs(contrib))[::-1][:k]
    base = float(np.exp(ridge.intercept_ + mu @ ridge.coef_))
    return dict(product=te.product_title.iat[i], actual=int(te.price.iat[i]),
                predicted=round(float(np.exp(ridge.predict(Ste[i])[0])), 0), baseline_price=round(base, 0),
                reasons=[f"{names[j]}: {'+' if contrib[j] > 0 else '−'}{abs(np.exp(contrib[j]) - 1) * 100:.0f}%" for j in order])
ex = [explain_row(i) for i in te.sample(4, random_state=3).index]

# B. Tree model on readable features
R = kgc + NUM
seg = pd.get_dummies(tr.segment).astype(float); segt = pd.get_dummies(te.segment).reindex(columns=seg.columns, fill_value=0).astype(float)
Btr = pd.concat([tr[R].reset_index(drop=True), seg.reset_index(drop=True)], axis=1)
Bte = pd.concat([te[R].reset_index(drop=True), segt.reset_index(drop=True)], axis=1)
Btr.columns = Bte.columns = [c.replace("kg_", "") for c in Btr.columns]
gb = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.05, random_state=42).fit(Btr, ytr)
from sklearn.metrics import r2_score
gb_r2 = r2_score(te.price, np.exp(gb.predict(Bte)))
tsv = shap.TreeExplainer(gb).shap_values(Bte.iloc[:3000])

out = dict(ridge_alpha=3, shap_check_max_abs_diff_vs_library=check,
           importance_by_group={k: round(float(v), 4) for k, v in grp.items()},
           top25_features=[(names[i], round(float(imp[i]), 4)) for i in top],
           strongest_price_raising=up, strongest_price_lowering=down, examples=ex,
           readable_gb_test_r2=round(float(gb_r2), 4))
json.dump(out, open("reports/models/part14_shap.json", "w"), indent=1)

plt.figure(figsize=(8, 7)); plt.barh(names[top][::-1], imp[top][::-1], color="tab:blue")
plt.xlabel("mean |SHAP value| on log price (test set)"); plt.title("Ridge (S9): 25 most influential features")
plt.tight_layout(); plt.savefig("figures/P14_ridge_top25.png", dpi=130); plt.close()
plt.figure(figsize=(6, 3.5)); plt.barh(grp.index[::-1], grp.values[::-1], color="tab:green")
plt.xlabel("summed mean |SHAP value|"); plt.title("Ridge: influence by feature group"); plt.tight_layout()
plt.savefig("figures/P14_ridge_groups.png", dpi=130); plt.close()
shap.summary_plot(tsv, Bte.iloc[:3000], max_display=20, show=False)
plt.title(f"Gradient boosting on readable features (test R² {gb_r2:.3f})"); plt.tight_layout()
plt.savefig("figures/P14_tree_beeswarm.png", dpi=130); plt.close()
print(json.dumps({k: v for k, v in out.items() if k not in ("examples",)}, indent=1)[:3500])
for e in ex: print("\n", e["product"], e["actual"], "pred", e["predicted"], "\n   ", "; ".join(e["reasons"]))
