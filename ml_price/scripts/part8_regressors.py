"""Part 8 — regression model comparison (Unit III: Linear, Polynomial, Decision Tree, Random Forest,
Gradient Boosting, KNN; cross-validation and hyperparameter tuning; R2).

Target: log(price); scores reported in rupees on the frozen test set.
Tuning: GridSearchCV, 5-fold GroupKFold on training rows (groups = product family), scored by
negative MAE on log price. n_jobs=3 (memory cap).
Inputs: 'sparse' = S9 features (one-hot, labels, TF-IDF, scaled numeric); 'dense' = text SVD (100) + KG +
numeric + segment; 'small' = 20 SVD dims + 4 scaled numeric (for polynomial expansion).
"""
import json, time, numpy as np, pandas as pd
from sklearn.model_selection import GroupKFold, GridSearchCV
from sklearn.dummy import DummyRegressor
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.preprocessing import PolynomialFeatures
from sklearn.pipeline import make_pipeline
from sklearn.tree import DecisionTreeRegressor
from sklearn.ensemble import RandomForestRegressor, HistGradientBoostingRegressor
from sklearn.neighbors import KNeighborsRegressor
from sklearn.metrics import r2_score, mean_absolute_error, mean_absolute_percentage_error
from features import load, dense, sparse

tr, te, kgc = load()
ytr, yte = np.log(tr.price.values), te.price.values
Str, Ste = sparse(tr, te, kgc)
Dtr, Dte, Ttr, Tte = dense(tr, te, kgc)
Smtr, Smte = np.hstack([Ttr[:, :20], Dtr[:, -21:-17]]), np.hstack([Tte[:, :20], Dte[:, -21:-17]])  # 20 SVD + 4 numeric
cv = list(GroupKFold(5).split(Str, groups=tr.family))
N = 3

MODELS = {
    "Median baseline": (DummyRegressor(strategy="median"), {}, "sparse"),
    "Linear Regression": (LinearRegression(), {}, "small"),
    "Polynomial Regression (deg 2)": (make_pipeline(PolynomialFeatures(2), Ridge(alpha=1.0)), {}, "small"),
    "Ridge": (Ridge(), {"alpha": [0.3, 1, 3, 10]}, "sparse"),
    "Decision Tree": (DecisionTreeRegressor(random_state=42), {"max_depth": [8, 16, 24], "min_samples_leaf": [5, 20]}, "dense"),
    "Random Forest": (RandomForestRegressor(n_estimators=300, n_jobs=N, random_state=42), {"min_samples_leaf": [2, 10]}, "dense"),
    "Gradient Boosting": (HistGradientBoostingRegressor(max_iter=500, random_state=42), {"learning_rate": [0.05, 0.1], "max_leaf_nodes": [31, 63]}, "dense"),
    "KNN (cosine, text)": (KNeighborsRegressor(metric="cosine", weights="distance"), {"n_neighbors": [5, 10, 25]}, "text"),
}
X = {"sparse": (Str, Ste), "dense": (Dtr, Dte), "small": (Smtr, Smte), "text": (Ttr, Tte)}
rows, preds = [], {}
for name, (est, grid, xs) in MODELS.items():
    t = time.time()
    a, b = X[xs]
    jobs = 1 if name == "Random Forest" else N        # RF already uses N workers inside
    gs = GridSearchCV(est, grid or {}, scoring="neg_mean_absolute_error", cv=cv, n_jobs=jobs).fit(a, ytr)
    p = np.exp(gs.predict(b)); preds[name] = p
    rows.append(dict(model=name, input=xs, best_params=str(gs.best_params_), cv_mae_log=round(-gs.best_score_, 4),
                     test_r2=round(r2_score(yte, p), 4), test_mae=round(mean_absolute_error(yte, p), 1),
                     test_mape=round(100 * mean_absolute_percentage_error(yte, p), 1), seconds=round(time.time() - t, 1)))
    print(rows[-1], flush=True)
# Simple average of the two best different families (linear + boosted trees)
avg = np.exp((np.log(preds["Ridge"]) + np.log(preds["Gradient Boosting"])) / 2)
rows.append(dict(model="Average of Ridge + Gradient Boosting", input="both", best_params="-", cv_mae_log=None,
                 test_r2=round(r2_score(yte, avg), 4), test_mae=round(mean_absolute_error(yte, avg), 1),
                 test_mape=round(100 * mean_absolute_percentage_error(yte, avg), 1), seconds=0))
res = pd.DataFrame(rows)
res.to_csv("reports/models/part8_regressors.csv", index=False)
print(res.drop(columns=["seconds"]).to_string(index=False))
