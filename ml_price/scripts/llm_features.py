"""Stage S10 features: LLM-extracted attributes (per unique description) + size / set size from each title.

LLM (part 12, engineered prompt): 17 material flags, handloom yes/no/unknown, set size.
Title regex (per row, because products sharing a description differ in size): largest dimension in cm,
set size ("Set of 10", "3pc", "Pack of 2"), size words (small / mini / big / large).
Output: data/features/llm_features.csv
"""
import json, re, numpy as np, pandas as pd

VOCAB = ["Silk", "Cotton", "Wool", "Linen", "Jute", "Zari", "Brass", "Copper", "Silver", "Iron", "Wood",
         "Bamboo", "Clay", "Stone", "Paper", "Leather", "Glass"]
d = pd.read_csv("data/final/handicraft_clean.csv.gz", keep_default_na=False)
idx = pd.read_csv("reports/llm/llm_attributes_unique_index.csv", keep_default_na=False)
llm = {}
for line in open("reports/llm/llm_attributes_unique.jsonl"):
    r = json.loads(line); llm[r["id"]] = r
gid = d.product_description.map(dict(zip(idx.product_description, idx.gid)))
rec = gid.map(llm)
f = pd.DataFrame({"image_file": d.image_file, "llm_found": rec.notna().astype(float)})
for m in VOCAB:
    f["llm_mat_" + m] = rec.map(lambda r: float(isinstance(r, dict) and m in (r.get("materials") or [])))
f["llm_handloom_yes"] = rec.map(lambda r: float(isinstance(r, dict) and r.get("handloom") == "yes"))
f["llm_handloom_no"] = rec.map(lambda r: float(isinstance(r, dict) and r.get("handloom") == "no"))

t = d.product_title.str.lower()
def set_size(s):
    m = re.search(r"set of (\d+)|pack of (\d+)|\b(\d+)\s?pc[s]?\b|\b(\d+)\s?pieces?\b", s)
    return float(next(g for g in m.groups() if g)) if m else 1.0
def max_dim_cm(s):
    vals = [(float(v), u) for v, u in re.findall(r"(\d+(?:\.\d+)?)\s?(cm|inch|inches|in|ft|feet|m)\b", s)]
    conv = {"cm": 1, "inch": 2.54, "inches": 2.54, "in": 2.54, "ft": 30.48, "feet": 30.48, "m": 100}
    return max((v * conv[u] for v, u in vals), default=np.nan)
f["title_set_size"] = t.map(set_size)
f["title_max_dim_cm"] = t.map(max_dim_cm)
f["title_has_size"] = f.title_max_dim_cm.notna().astype(float)
f["title_max_dim_cm"] = np.log1p(f.title_max_dim_cm.fillna(0))          # log scale; 0 when no size given
f["title_small_word"] = t.str.contains(r"\b(?:small|mini|tiny|kids)\b").astype(float)
f["title_big_word"] = t.str.contains(r"\b(?:big|large|jumbo|xl)\b").astype(float)
f["log_title_set_size"] = np.log(f.pop("title_set_size"))
f.to_csv("data/features/llm_features.csv", index=False)
print("rows", len(f), "| with LLM attributes", int(f.llm_found.sum()), "| with a size in the title", int(f.title_has_size.sum()),
      "| set size > 1:", int((f.log_title_set_size > 0).sum()))
