"""Part 7 — underpricing detector (Unit IV: anomaly detection).

Expected price = S8 Ridge model (TF-IDF + labels + KG features + segment, log target).
- Training rows: 5-fold out-of-fold predictions, folds grouped by product family, so a product
  (or its near-copies) never helps predict itself.
- Test rows: model trained on all training rows.
Flag "possible underpricing" when actual price < 50% of expected. Cross-checked with the Isolation
Forest flags from step 2.9. A flag is a prompt for review, not proof: the data has no costs or
labour hours, so it can't say what a fair price is.
Outputs: reports/unsupervised/underpricing.json, data/features/underpricing_flags.csv, figures/P7_*.png
"""
import json, numpy as np, pandas as pd, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.model_selection import GroupKFold
from sklearn.linear_model import Ridge
from sklearn.preprocessing import OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import make_pipeline
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer

tr = pd.read_csv("data/splits/train.csv", keep_default_na=False)
te = pd.read_csv("data/splits/test.csv", keep_default_na=False)
fam = pd.read_csv("data/splits/split_assignment.csv").set_index("image_file").family
kg = pd.read_csv("data/features/kg_features.csv")
seg = pd.read_csv("data/features/segment_features.csv")
def prep(x):
    x = x.merge(kg, on="image_file").merge(seg, on="image_file")
    x["segment"] = "seg" + x.segment.astype(str)
    x["text"] = x.product_title + " " + x.product_description
    return x
tr, te = prep(tr), prep(te)
kgc = [c for c in kg.columns if c != "image_file"]
num = ["artform_count", "title_len", "desc_len", "desc_repeat"] + kgc
for x in (tr, te):
    x[kgc] = x[kgc].astype(float)
X = ["primary_artform", "segment", "artform_all", "text"] + num
def model():
    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore"), ["primary_artform", "segment"]),
        ("lab", CountVectorizer(tokenizer=lambda t: t.split(" | "), token_pattern=None, lowercase=False, binary=True), "artform_all"),
        ("txt", TfidfVectorizer(max_features=5000, ngram_range=(1, 2), min_df=5, sublinear_tf=True, stop_words="english"), "text"),
    ], remainder="passthrough")
    return make_pipeline(pre, Ridge(alpha=1.0))

oof = np.zeros(len(tr))
for a, b in GroupKFold(n_splits=5).split(tr, groups=tr.image_file.map(fam)):
    oof[b] = np.exp(model().fit(tr.iloc[a][X], np.log(tr.price.iloc[a])).predict(tr.iloc[b][X]))
pte = np.exp(model().fit(tr[X], np.log(tr.price)).predict(te[X]))

iso = pd.read_csv("data/splits/train_outlier_flags.csv").set_index("image_file").iso
res = pd.concat([tr.assign(expected=oof, split="train"), te.assign(expected=pte, split="test")])
res["ratio"] = res.price / res.expected
res["flag_under"] = res.ratio < 0.5
res["flag_over"] = res.ratio > 2.0
res["iso_flag"] = res.image_file.map(iso)            # only defined for training rows
cols = ["image_file", "split", "product_title", "primary_artform", "price", "expected", "ratio", "flag_under", "flag_over"]
res[cols].round(2).to_csv("data/features/underpricing_flags.csv", index=False)

u = res[res.flag_under]
by_af = (res.groupby("primary_artform").agg(rows=("price", "size"), under=("flag_under", "sum"))
         .query("rows >= 100").assign(share=lambda x: (x.under / x.rows).round(3))
         .sort_values("share", ascending=False))
trn = res[res.split == "train"]
out = dict(
    rows=len(res), flagged_under=int(res.flag_under.sum()), flagged_under_share=round(float(res.flag_under.mean()), 4),
    flagged_over=int(res.flag_over.sum()),
    median_ratio=round(float(res.ratio.median()), 3),
    train_overlap_with_isolation_forest=dict(
        under_flags=int(trn.flag_under.sum()), iso_flags=int(trn.iso_flag.sum()),
        both=int((trn.flag_under & trn.iso_flag).sum())),
    top_artforms_by_under_share=by_af.head(10).reset_index().to_dict("records"),
    examples=u.sort_values("ratio").head(12)[["product_title", "primary_artform", "price", "expected", "ratio"]]
             .round(2).to_dict("records"))
json.dump(out, open("reports/unsupervised/underpricing.json", "w"), indent=1, default=str)

plt.figure(figsize=(7, 4))
plt.hist(np.log2(res.ratio), bins=80, color="tab:blue", alpha=.8)
plt.axvline(-1, color="red", ls="--", label="price = 50% of expected (flag)")
plt.axvline(1, color="orange", ls="--", label="price = 200% of expected")
plt.xlabel("log2(actual / expected price)"); plt.ylabel("products"); plt.legend()
plt.title("Actual vs model-expected price, all 37,257 products"); plt.tight_layout()
plt.savefig("figures/P7_price_ratio.png", dpi=140)
print(json.dumps({k: v for k, v in out.items() if k not in ("examples", "top_artforms_by_under_share")}, indent=1))
print(by_af.head(8).to_string())
for e in out["examples"][:10]:
    print(f"  ₹{e['price']:>7} vs expected ₹{e['expected']:>8.0f} ({e['ratio']:.2f})  {e['primary_artform']:25s} {e['product_title'][:70]}")
