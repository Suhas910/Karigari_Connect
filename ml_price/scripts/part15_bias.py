"""Part 15 — bias audit (Unit V: responsible AI, bias).

Model: Ridge (alpha=3, S9 features), the tuned best model from part 8. Test set only.
For each group: rows, median ratio predicted/actual (1.0 = unbiased; <1 = model prices the group too low),
MAPE, share of products under-priced by more than 30%.
Groups: price band, primary art form (>= 60 test rows), segment, technique family, label specificity,
skilled-labour rule, description templating.
"""
import json, numpy as np, pandas as pd, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.linear_model import Ridge
from features import load, sparse

tr, te, kgc = load()
Str, Ste = sparse(tr, te, kgc)
pred = np.exp(Ridge(alpha=3).fit(Str, np.log(tr.price.values)).predict(Ste))
te = te.assign(pred=pred, ratio=pred / te.price.values, ape=np.abs(pred - te.price.values) / te.price.values)
cuts = tr.price.quantile([1 / 3, 2 / 3]).values
te["band"] = pd.cut(te.price, [0, cuts[0], cuts[1], 1e9], labels=["low (<₹590)", "mid", "high (>₹1,850)"]).astype(str)
te["price_decile"] = pd.qcut(te.price, 10, labels=[f"D{i}" for i in range(1, 11)]).astype(str)
GENERIC = {"handmade", "natural dyed", "plain solid", "handloom", "hand painted", "upcycled", "fabart", "other"}
te["label_type"] = np.where(te.primary_artform.isin(GENERIC), "generic label only", "specific craft label")
te["technique_family"] = np.select(
    [te.kg_tech_Weaving == 1, te.kg_tech_Printing == 1, te.kg_tech_ResistDyeing == 1, te.kg_tech_Embroidery == 1,
     te.kg_tech_Painting == 1, te.kg_tech_MetalCraft == 1, te.kg_tech_WoodCraft == 1, te.kg_tech_BeadWork == 1],
    ["weaving", "printing", "tie-dye", "embroidery", "painting", "metal", "wood", "bead work"], "other / none")
te["skilled_rule"] = np.where(te.kg_skilled == 1, "skilled technique (R5)", "not rated skilled")
te["templated_text"] = np.where(te.desc_repeat >= 10, "description shared by ≥10 listings", "description shared by <10")

def table(col, min_rows=1):
    g = te.groupby(col).agg(rows=("price", "size"), median_price=("price", "median"),
                            median_ratio=("ratio", "median"), mape=("ape", "mean"),
                            underpriced_30=("ratio", lambda r: (r < 0.7).mean()))
    g = g[g.rows >= min_rows]
    g["mape"] = (100 * g.mape).round(1); g["underpriced_30"] = (100 * g.underpriced_30).round(1)
    g["median_ratio"] = g.median_ratio.round(3)
    return g.sort_values("median_ratio")
out = {"overall": dict(rows=len(te), median_ratio=round(float(te.ratio.median()), 3), mape=round(float(100 * te.ape.mean()), 1))}
for col, mr in [("band", 1), ("price_decile", 1), ("technique_family", 1), ("label_type", 1), ("skilled_rule", 1),
                ("templated_text", 1), ("primary_artform", 60), ("segment", 1)]:
    out[col] = table(col, mr).reset_index().to_dict("records")
json.dump(out, open("reports/models/part15_bias.json", "w"), indent=1, default=float)

d = table("price_decile").reindex([f"D{i}" for i in range(1, 11)])
fig, ax = plt.subplots(1, 2, figsize=(12, 4))
ax[0].bar(d.index, d.median_ratio, color=["tab:red" if r < 1 else "tab:blue" for r in d.median_ratio])
ax[0].axhline(1, color="k", lw=.8); ax[0].set_title("Median predicted ÷ actual price, by actual-price decile")
ax[0].set_xlabel("D1 = cheapest 10% … D10 = most expensive 10%")
a = table("primary_artform", 60).iloc[list(range(6)) + list(range(-6, 0))]
ax[1].barh(a.index, a.median_ratio, color=["tab:red" if r < 1 else "tab:blue" for r in a.median_ratio])
ax[1].axvline(1, color="k", lw=.8); ax[1].set_title("Most under- and over-priced art forms (≥60 test rows)")
plt.tight_layout(); plt.savefig("figures/P15_bias.png", dpi=130)
print(json.dumps(out["overall"]))
for col in ["band", "price_decile", "technique_family", "label_type", "skilled_rule", "templated_text"]:
    print("\n==", col); print(table(col).to_string())
print("\n== primary_artform (>=60)"); t = table("primary_artform", 60); print(t.head(8).to_string()); print(t.tail(5).to_string())
