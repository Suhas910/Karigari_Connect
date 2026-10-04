"""Part 6 — association rules (Unit IV: Apriori, support, confidence, lift). Training rows only.

Each product is a 'basket' of items: its art-form labels (AF:), materials (MAT:) and technique
groups (TECH:) from the knowledge graph, plus its price band (BAND:low/mid/high, training tertiles).
Two analyses:
  1. Which crafts, materials and techniques go together (co-occurrence rules)
  2. Which combinations predict the HIGH price band (rules with BAND:high as the consequent)
"""
import json, pandas as pd
from mlxtend.frequent_patterns import apriori, association_rules

tr = pd.read_csv("data/splits/train.csv", keep_default_na=False)
kg = pd.read_csv("data/features/kg_features.csv").set_index("image_file")
k = kg.loc[tr.image_file].reset_index(drop=True)
cuts = tr.price.quantile([1 / 3, 2 / 3]).values
band = pd.cut(tr.price, [-1, cuts[0], cuts[1], 1e9], labels=["low", "mid", "high"]).astype(str)

baskets = []
for i in range(len(tr)):
    items = {"AF:" + a for a in tr.artform_all.iat[i].split(" | ")}
    items |= {"MAT:" + c[7:] for c in k.columns if c.startswith("kg_mat_") and k[c].iat[i]}
    items |= {"TECH:" + c[8:] for c in k.columns if c.startswith("kg_tech_") and k[c].iat[i]}
    items.add("BAND:" + band.iat[i])
    baskets.append(items)
allitems = sorted(set().union(*baskets))
X = pd.DataFrame([[it in b for it in allitems] for b in baskets], columns=allitems)

MIN_SUP = 0.01   # itemset must appear in >= 1% of baskets (~298 products)
freq = apriori(X, min_support=MIN_SUP, use_colnames=True, max_len=4)
rules = association_rules(freq, metric="confidence", min_threshold=0.5)
rules = rules[rules.lift >= 1.5]
fmt = lambda s: " + ".join(sorted(s))
rules = rules.assign(antecedent=rules.antecedents.map(fmt), consequent=rules.consequents.map(fmt))
cols = ["antecedent", "consequent", "support", "confidence", "lift"]

# 1. craft -> material: one art form predicting one material (rules like "art form -> its own technique
#    group" are true by construction and are left out)
co = rules[(rules.antecedents.map(len) == 1) & (rules.consequents.map(len) == 1)
           & rules.antecedent.str.startswith("AF:") & rules.consequent.str.startswith("MAT:")]
co = co.sort_values("lift", ascending=False).head(15)
# 2. price: BAND:high as the only consequent
hi = rules[rules.consequent == "BAND:high"].sort_values(["lift", "support"], ascending=False)
lo = rules[rules.consequent == "BAND:low"].sort_values(["lift", "support"], ascending=False)

out = dict(baskets=len(baskets), distinct_items=len(allitems), min_support=MIN_SUP,
           frequent_itemsets=len(freq), rules_conf50_lift15=len(rules), band_cut_points=[float(c) for c in cuts],
           cooccurrence=co[cols].round(3).to_dict("records"),
           high_band=hi[cols].head(15).round(3).to_dict("records"),
           low_band=lo[cols].head(10).round(3).to_dict("records"))
json.dump(out, open("reports/unsupervised/apriori.json", "w"), indent=1)
rules[cols].round(4).to_csv("reports/unsupervised/apriori_all_rules.csv", index=False)
print({k: v for k, v in out.items() if not isinstance(v, list) or k == "band_cut_points"})
for name in ["cooccurrence", "high_band", "low_band"]:
    print("\n==", name)
    for r in out[name][:10]:
        print(f"  {r['antecedent']}  ->  {r['consequent']}   sup {r['support']}  conf {r['confidence']}  lift {r['lift']}")
