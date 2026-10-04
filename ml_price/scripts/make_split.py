"""Create the frozen train/test split (run once).

- Grouped by product family (v3): rows are joined (union-find) when they share a variant_group, OR
  an identical description, OR near-identical text (TF-IDF cosine similarity >= 0.8 between
  title + description, checked over each row's 30 nearest neighbours). A family lands entirely
  on one side.
  History: v1 grouped by variant_group only -> 71% of test rows shared an exact description with
  training. v2 added exact descriptions -> 72% of test rows still had a >= 0.9-similar training
  row (colour variants with reworded text); copying the nearest training price scored R2 0.841.
- Stratified by primary_artform: every art form appears in both sets in similar proportion.
- 80 / 20, fixed seed 42. Rows are identified by image_file (unique per row).
"""
import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.neighbors import NearestNeighbors

SIM = 0.8  # near-duplicate threshold; 0.7 chains into one 2,585-row family, 0.8 keeps the largest at 629

d = pd.read_csv("data/final/handicraft_clean.csv.gz", dtype=str, keep_default_na=False)
assert d.image_file.is_unique

# Union-find over the two keys -> family id
parent = {}
def find(x):
    parent.setdefault(x, x)
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x
for i, (v, desc) in enumerate(zip(d.variant_group, d.product_description)):
    parent[find(f"r:{i}")] = find("v:" + v)
    parent[find("v:" + v)] = find("d:" + desc)
X = TfidfVectorizer(sublinear_tf=True, min_df=2).fit_transform(d.product_title + " " + d.product_description)
dist, idx = NearestNeighbors(n_neighbors=30, metric="cosine").fit(X).kneighbors(X)
for i in range(len(d)):
    for j, ds in zip(idx[i], dist[i]):
        if 1 - ds >= SIM:
            parent[find(f"r:{i}")] = find(f"r:{j}")
d["family"] = [find(f"r:{i}") for i in range(len(d))]
fam_ids = {f: i for i, f in enumerate(pd.unique(d.family))}
d["family"] = d.family.map(fam_ids)
print("families:", d.family.nunique(), "| largest:", d.family.value_counts().max())

folds = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=42)
_, test_idx = next(folds.split(d, d.primary_artform, groups=d.family))
d["split"] = "train"
d.loc[d.index[test_idx], "split"] = "test"

d[["image_file", "variant_group", "family", "primary_artform", "split"]].to_csv("data/splits/split_assignment.csv", index=False)
d[d.split == "train"].drop(columns=["split", "family"]).to_csv("data/splits/train.csv", index=False)
d[d.split == "test"].drop(columns=["split", "family"]).to_csv("data/splits/test.csv", index=False)

# Checks printed for the report
tr, te = d[d.split == "train"], d[d.split == "test"]
p = lambda x: pd.to_numeric(x.price)
print("rows train/test:", len(tr), len(te), f"({len(te)/len(d):.1%} test)")
print("variant groups on both sides:", len(set(tr.variant_group) & set(te.variant_group)))
print("descriptions on both sides:", len(set(tr.product_description) & set(te.product_description)))
print("art forms only in train:", len(set(tr.primary_artform) - set(te.primary_artform)),
      "| only in test:", len(set(te.primary_artform) - set(tr.primary_artform)))
for name, x in [("train", tr), ("test", te)]:
    print(name, "price mean/median/std:", round(p(x).mean(), 2), p(x).median(), round(p(x).std(), 2))
