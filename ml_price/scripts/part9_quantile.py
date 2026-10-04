"""Part 9 — price RANGE instead of a single price: quantile gradient boosting on log(price).

Three models predict the 10th, 50th and 90th percentile of price for a product. A good 80% range
should contain the true price for about 80% of test products (coverage), while being as narrow as
possible (width). Also compared: a fixed range around the Ridge point prediction (±k·residual spread,
k chosen on training out-of-fold residuals), the simplest alternative.
"""
import json, numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.model_selection import GroupKFold
from sklearn.metrics import mean_pinball_loss, r2_score, mean_absolute_error
from features import load, dense, sparse

tr, te, kgc = load()
Xtr, Xte, _, _ = dense(tr, te, kgc)
ytr, yte = np.log(tr.price.values), te.price.values
Q = {}
for q in (0.1, 0.5, 0.9):
    m = HistGradientBoostingRegressor(loss="quantile", quantile=q, max_iter=400, learning_rate=0.05,
                                      max_leaf_nodes=31, random_state=42).fit(Xtr, ytr)
    Q[q] = np.exp(m.predict(Xte))
lo, mid, hi = np.minimum(Q[0.1], Q[0.5]), Q[0.5], np.maximum(Q[0.9], Q[0.5])

# Conformalised quantile regression (CQR): widen the raw range by the 80th percentile of the
# out-of-fold "how far outside the range" scores, computed with folds grouped by product family.
qm = lambda q: HistGradientBoostingRegressor(loss="quantile", quantile=q, max_iter=400, learning_rate=0.05,
                                             max_leaf_nodes=31, random_state=42)
olo, ohi = np.zeros(len(tr)), np.zeros(len(tr))
for a, b in GroupKFold(5).split(Xtr, groups=tr.family):
    olo[b] = qm(0.1).fit(Xtr[a], ytr[a]).predict(Xtr[b])
    ohi[b] = qm(0.9).fit(Xtr[a], ytr[a]).predict(Xtr[b])
E = np.maximum(olo - ytr, ytr - ohi)
qhat = float(np.quantile(E, min(1.0, 0.8 * (1 + 1 / len(E)))))
c_lo, c_hi = np.exp(np.log(lo) - qhat), np.exp(np.log(hi) + qhat)

# Baseline range: Ridge point prediction (S8 features) +/- the 10th/90th percentile of out-of-fold log residuals
Str, Ste = sparse(tr, te, kgc)
oof = np.zeros(len(tr))
for a, b in GroupKFold(5).split(Str, groups=tr.family):
    oof[b] = Ridge(alpha=1.0).fit(Str[a], ytr[a]).predict(Str[b])
r_lo, r_hi = np.percentile(ytr - oof, [10, 90])
pr = Ridge(alpha=1.0).fit(Str, ytr).predict(Ste)
b_lo, b_hi, b_mid = np.exp(pr + r_lo), np.exp(pr + r_hi), np.exp(pr)

def summ(lo, mid, hi):
    inside = (yte >= lo) & (yte <= hi)
    return dict(coverage_80=round(float(inside.mean()), 3),
                median_width_inr=round(float(np.median(hi - lo)), 0),
                median_relative_width=round(float(np.median((hi - lo) / mid)), 3),
                below_range=round(float((yte < lo).mean()), 3), above_range=round(float((yte > hi).mean()), 3),
                point_r2=round(float(r2_score(yte, mid)), 4), point_mae=round(float(mean_absolute_error(yte, mid)), 1))
out = {"quantile_gbm": summ(lo, mid, hi), "quantile_gbm_conformal": summ(c_lo, mid, c_hi),
       "conformal_widening_log": round(qhat, 4),
       "ridge_plus_fixed_band": summ(b_lo, b_mid, b_hi),
       "pinball_loss_log_scale": {str(q): round(float(mean_pinball_loss(np.log(yte), np.log(Q[q]), alpha=q)), 4)
                                  for q in Q}}
# Coverage by price band, to see where the range fails
band = pd.qcut(yte, 3, labels=["low", "mid", "high"])
cov = lambda L, H: {b: round(float(((yte >= L) & (yte <= H))[band == b].mean()), 3) for b in ["low", "mid", "high"]}
out["coverage_by_band"] = {"quantile_gbm": cov(lo, hi), "quantile_gbm_conformal": cov(c_lo, c_hi), "ridge_plus_fixed_band": cov(b_lo, b_hi)}
ex = te.assign(lo=c_lo.round(-1), mid=mid.round(-1), hi=c_hi.round(-1)).sample(6, random_state=7)
out["examples"] = ex[["product_title", "price", "lo", "mid", "hi"]].to_dict("records")
json.dump(out, open("reports/models/part9_quantile.json", "w"), indent=1)
print(json.dumps({k: v for k, v in out.items() if k != "examples"}, indent=1))
for e in out["examples"]:
    print(f"  ₹{e['price']:>6}  range ₹{e['lo']:.0f}–{e['hi']:.0f} (mid {e['mid']:.0f})  {e['product_title'][:60]}")
