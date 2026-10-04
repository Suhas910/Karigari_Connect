"""Part 13 — image features from a pretrained CNN (Unit V: CNNs, transfer learning, embeddings).

Input: data/features/image_embeddings_squeezenet.tab, written by Orange (Import Images -> Image
Embedding, SqueezeNet (local) -> Save Data; workflow tool_exports/orange/P13_image_embedding.ows).
SqueezeNet was trained on ImageNet and is used as a fixed feature extractor: 1,000 numbers per
photo, no retraining, no prices involved.

1. Match every embedding to its product (image file name); report skipped or missing images.
2. PCA fitted on TRAINING rows only (standardised) -> 256 components, saved for the stage harness
   (data/features/image_pca.csv.gz; the raw 1,000-column file stays git-ignored, it is ~300 MB).
3. Image-only Ridge: what do the photos alone say about price? Grouped 5-fold CV picks the number of
   components (16 / 32 / 64 / 128 / 256); test scored once.
4. Same CV choice for photos ADDED to the S12 features (Ridge, TF-IDF 20k, min_df 2, alpha 1).
The chosen number of components is written to reports/models/part13_images.json and used by stage
S12-img in evaluate_stage.py.
"""
import json, numpy as np, pandas as pd
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.metrics import r2_score, mean_absolute_error, mean_absolute_percentage_error

N = 4
emb = pd.read_csv("data/features/image_embeddings_squeezenet.tab", sep="\t", low_memory=False)
num_cols = [c for c in emb.columns if c.startswith("n") and c[1:].isdigit()]
name_col = "image" if "image" in emb.columns else emb.columns[0]
emb["image_file"] = emb[name_col].astype(str).str.split("/").str[-1]
sa = pd.read_csv("data/splits/split_assignment.csv").set_index("image_file")
prices = pd.read_csv("data/final/handicraft_clean.csv.gz", usecols=["image_file", "price"], keep_default_na=False)
out = {"embedding_rows": len(emb), "embedding_dims": len(num_cols),
       "products": len(prices), "products_with_embedding": int(prices.image_file.isin(emb.image_file).sum())}
d = prices.merge(emb[["image_file"] + num_cols], on="image_file")
d["split"], d["family"] = d.image_file.map(sa.split), d.image_file.map(sa.family)
tr_mask = (d.split == "train").values
X = d[num_cols].values.astype(np.float32)

sc = StandardScaler().fit(X[tr_mask])
pca = PCA(n_components=256, random_state=42).fit(sc.transform(X[tr_mask]))
Z = pca.transform(sc.transform(X))
out["pca_explained_variance"] = {k: round(float(pca.explained_variance_ratio_[:k].sum()), 3) for k in (16, 32, 64, 128)}
pd.DataFrame(Z.astype(np.float32), columns=[f"img_pc{i + 1}" for i in range(256)]).round(5).assign(
    image_file=d.image_file.values).to_csv("data/features/image_pca.csv.gz", index=False)

tr, te = d[tr_mask].reset_index(drop=True), d[~tr_mask].reset_index(drop=True)
Ztr, Zte = Z[tr_mask], Z[~tr_mask]
ytr = np.log(tr.price.values)
cv = list(GroupKFold(5).split(Ztr, groups=tr.family))
def sc_(y, p):
    return dict(r2=round(r2_score(y, p), 4), mae=round(mean_absolute_error(y, p), 1),
                mape=round(100 * mean_absolute_percentage_error(y, p), 1))

# Image-only Ridge
img_only = {}
for k in (16, 32, 64, 128, 256):
    oof = np.exp(cross_val_predict(Ridge(alpha=1.0), Ztr[:, :k], ytr, cv=cv, n_jobs=N))
    img_only[k] = sc_(tr.price, oof)
best_k = max(img_only, key=lambda k: img_only[k]["r2"])
test_pred = np.exp(Ridge(alpha=1.0).fit(Ztr[:, :best_k], ytr).predict(Zte[:, :best_k]))
out["image_only_ridge"] = {"cv_by_components": img_only, "chosen_components": best_k, "test": sc_(te.price, test_pred)}
print(json.dumps(out, indent=1), flush=True)

# Photos added to the S12 feature set: choose the number of components by grouped CV
# Re-use part 8b's S12 feature builder (the code above its "# --- ablation" line) without re-running
# its experiments.
src = open("scripts/part8b_ablation_tuning.py").read().split("# --- ablation")[0]
ns = {}; exec(src, ns)
base, make_pre, GROUPS = ns["d"], ns["make_pre"], ns["GROUPS"]
base = base.merge(pd.read_csv("data/features/image_pca.csv.gz"), on="image_file")
btr, bte = base[base.split == "train"].reset_index(drop=True), base[base.split == "test"].reset_index(drop=True)
bcv = list(GroupKFold(5).split(btr, groups=btr.family))
from sklearn.pipeline import Pipeline
combined = {}
for k in (0, 16, 32, 64, 128, 256):
    GROUPS["image (SqueezeNet PCA)"] = ("num", [f"img_pc{i + 1}" for i in range(k)])
    groups = [g for g in GROUPS if g != "image (SqueezeNet PCA)" or k > 0]
    m = Pipeline([("pre", make_pre(groups, max_features=20000, min_df=2)), ("ridge", Ridge(alpha=1.0))])
    oof = np.exp(cross_val_predict(m, btr, np.log(btr.price.values), cv=bcv, n_jobs=N))
    combined[k] = sc_(btr.price, oof); print(k, combined[k], flush=True)
best_c = max(combined, key=lambda k: combined[k]["r2"])
out["s12_plus_images_cv"] = {"cv_by_components": combined, "chosen_components": best_c}
json.dump(out, open("reports/models/part13_images.json", "w"), indent=1)
print(json.dumps(out["s12_plus_images_cv"], indent=1))
