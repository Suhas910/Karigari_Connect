"""Part 10 — price-band classifier comparison (Unit III: Logistic Regression, SVM, Naive Bayes, KNN,
Decision Tree, Random Forest, Gradient Boosting; cross-validation, tuning, accuracy/precision/recall/
F1/ROC-AUC/confusion matrix).

Target: price band low / mid / high (training-set tertiles: < ₹590, ₹590-1,850, > ₹1,850).
Tuning: 5-fold GroupKFold on the TRAINING split (groups = product family), macro-F1.
Final scores: once, on the frozen test set.
"""
import json, time, numpy as np, pandas as pd, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.model_selection import GroupKFold, GridSearchCV
from sklearn.linear_model import LogisticRegression
from sklearn.svm import LinearSVC
from sklearn.calibration import CalibratedClassifierCV
from sklearn.naive_bayes import MultinomialNB
from sklearn.neighbors import KNeighborsClassifier
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier, HistGradientBoostingClassifier
from sklearn.metrics import (accuracy_score, precision_recall_fscore_support, roc_auc_score,
                             confusion_matrix, ConfusionMatrixDisplay)
from sklearn.feature_extraction.text import TfidfVectorizer
from features import load, dense, sparse

tr, te, kgc = load()
cuts = tr.price.quantile([1 / 3, 2 / 3]).values
band = lambda p: np.digitize(p, cuts)                  # 0 low, 1 mid, 2 high
ytr, yte = band(tr.price.values), band(te.price.values)
Str, Ste = sparse(tr, te, kgc)                         # scaled numerics -> fine for linear models
Dtr, Dte, Ttr, Tte = dense(tr, te, kgc)                # compact dense features for trees / KNN
tf = TfidfVectorizer(max_features=5000, ngram_range=(1, 2), min_df=5, sublinear_tf=True, stop_words="english")
Ntr, Nte = tf.fit_transform(tr.text), tf.transform(te.text)   # non-negative counts-style input for Naive Bayes
cv = list(GroupKFold(5).split(Str, groups=tr.family))

MODELS = {  # name: (estimator, param grid, train X, test X)
    "Logistic Regression": (LogisticRegression(max_iter=3000), {"C": [0.1, 1, 10]}, Str, Ste),
    "Linear SVM": (CalibratedClassifierCV(LinearSVC(), cv=3), {"estimator__C": [0.01, 0.1, 1]}, Str, Ste),
    "Naive Bayes (multinomial)": (MultinomialNB(), {"alpha": [0.1, 0.5, 1.0]}, Ntr, Nte),
    "KNN (cosine, text)": (KNeighborsClassifier(metric="cosine", weights="distance"), {"n_neighbors": [5, 15, 35]}, Ttr, Tte),
    "Decision Tree": (DecisionTreeClassifier(random_state=42), {"max_depth": [8, 16, None], "min_samples_leaf": [5]}, Dtr, Dte),
    "Random Forest": (RandomForestClassifier(n_estimators=300, n_jobs=4, random_state=42), {"min_samples_leaf": [1, 5]}, Dtr, Dte),
    "Gradient Boosting": (HistGradientBoostingClassifier(random_state=42), {"learning_rate": [0.05, 0.1], "max_iter": [300]}, Dtr, Dte),
}
rows, cms = [], {}
for name, (est, grid, Xa, Xb) in MODELS.items():
    t = time.time()
    gs = GridSearchCV(est, grid, scoring="f1_macro", cv=cv, n_jobs=4).fit(Xa, ytr)
    pred, prob = gs.predict(Xb), gs.predict_proba(Xb)
    p, r, f, _ = precision_recall_fscore_support(yte, pred, average="macro")
    rows.append(dict(model=name, best_params=gs.best_params_, cv_f1=round(gs.best_score_, 4),
                     test_accuracy=round(accuracy_score(yte, pred), 4), test_precision=round(p, 4),
                     test_recall=round(r, 4), test_f1=round(f, 4),
                     test_roc_auc=round(roc_auc_score(yte, prob, multi_class="ovr"), 4),
                     seconds=round(time.time() - t, 1)))
    cms[name] = confusion_matrix(yte, pred)
    print(rows[-1])
res = pd.DataFrame(rows).sort_values("test_f1", ascending=False)
res.to_csv("reports/models/part10_classifiers.csv", index=False)
json.dump(dict(band_cut_points=[float(c) for c in cuts], test_band_counts=np.bincount(yte).tolist(),
               results=res.to_dict("records"),
               confusion_matrices={k: v.tolist() for k, v in cms.items()}), open("reports/models/part10_classifiers.json", "w"),
          indent=1, default=str)

fig, axes = plt.subplots(2, 4, figsize=(16, 8))
for ax, (name, cm) in zip(axes.flat, cms.items()):
    ConfusionMatrixDisplay(cm, display_labels=["low", "mid", "high"]).plot(ax=ax, colorbar=False)
    ax.set_title(f"{name}\nF1 {res.set_index('model').test_f1[name]:.3f}", fontsize=10)
axes.flat[-1].axis("off")
plt.tight_layout(); plt.savefig("figures/P10_confusion_matrices.png", dpi=120)
print(res[["model", "cv_f1", "test_accuracy", "test_f1", "test_roc_auc", "best_params"]].to_string(index=False))
