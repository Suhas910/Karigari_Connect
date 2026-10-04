"""Build the craft knowledge graph (OWL ontology) from the cleaned data, run the HermiT reasoner
with SWRL rules, and save it for Protégé.

Outputs
- tool_exports/protege/craft_kg.owl          ontology: classes, art forms, materials, rules, sample products
- tool_exports/protege/artform_technique_map.csv   which technique each art-form label was mapped to (review this)
- data/features/kg_features.csv              rule-derived features for every row (same rules, applied in pandas)

The reasoner runs on a sample of products (HermiT on all 37k products is slow); the same rules are
applied to every row in pandas, and the two are checked to agree on the sample.
"""
import json, re, random
import pandas as pd
from owlready2 import (get_ontology, Thing, ObjectProperty, Imp, sync_reasoner, destroy_entity,
                       default_world)

d = pd.read_csv("data/final/handicraft_clean.csv.gz", dtype=str, keep_default_na=False)

# ---------- 1-3. Technique map, materials and rules live in kg_rules.py (shared with the demo)
from kg_rules import TECH_RULES, TEXTILE_PARENTS, OTHER_PARENTS, SKILL, MATERIALS, technique, kg_features
labels = sorted({x for s in d.artform_all for x in s.split(" | ")})
amap = pd.DataFrame({"artform": labels, "technique": [technique(l) for l in labels]})
amap.to_csv("tool_exports/protege/artform_technique_map.csv", index=False)
text = (d.product_title + " " + d.product_description).str.lower()
for m, (_, kws) in MATERIALS.items():
    d["mat_" + m] = text.str.contains(r"\b(?:" + "|".join(kws) + r")\b", regex=True)
f = kg_features(d)
import os; os.makedirs("data/features", exist_ok=True)
f.to_csv("data/features/kg_features.csv", index=False)

# ---------- 4. OWL ontology + SWRL rules + HermiT on a sample of products
onto = get_ontology("http://karigari.example/craft_kg.owl")
with onto:
    class Product(Thing): pass
    class ArtForm(Thing): pass
    class Technique(Thing): pass
    class Material(Thing): pass
    class SkillLevel(Thing): pass
    class hasArtForm(ObjectProperty): domain = [Product]; range = [ArtForm]
    class usesTechnique(ObjectProperty): domain = [ArtForm]; range = [Technique]
    class hasMaterial(ObjectProperty): domain = [Product]; range = [Material]
    class requiresSkill(ObjectProperty): domain = [Technique]; range = [SkillLevel]
import types
with onto:
    C = {"Craft": types.new_class("Craft", (onto.Technique,))}
    order = ["TextileTechnique", "Painting", "WoodCraft", "ClayCraft", "MetalCraft", "PaperCraft",
             "NaturalFibreCraft", "Weaving", "Printing", "ResistDyeing"]
    for name in order:
        par = TEXTILE_PARENTS.get(name) or OTHER_PARENTS.get(name) or "Craft"
        C[name] = types.new_class(name, (C[par],))
    for cls, par, _ in TECH_RULES:
        if cls not in C:
            C[cls] = types.new_class(cls, (C[par],))
    M = {}
    for grp in ["Fibre", "MetallicThread", "Metal", "PlantMaterial", "EarthMaterial", "AnimalMaterial"]:
        M[grp] = types.new_class(grp, (onto.Material,))
    for m, (par, _) in MATERIALS.items():
        M[m] = types.new_class(m, (M[par],))
    skilled, semi = onto.SkillLevel("skilled"), onto.SkillLevel("semi_skilled")
    tech_ind = {}
    for cls in C:
        t = C[cls]("tech_" + cls)
        tech_ind[cls] = t
    for cls, lvl in SKILL.items():  # class-level axiom: every technique of this class (and its subclasses) requires the level
        C[cls].is_a.append(onto.requiresSkill.value(skilled if lvl == "skilled" else semi))
    af_ind = {}
    for lab, tq in zip(amap.artform, amap.technique):
        a = onto.ArtForm("af_" + re.sub(r"\W+", "_", lab))
        a.label = [lab]
        if isinstance(tq, str):
            a.usesTechnique = [tech_ind[tq]]
        af_ind[lab] = a
    mat_ind = {m: M[m]("mat_" + m) for m in MATERIALS}
    # inferred classes, defined only by rules
    for n in ["TextileProduct", "HandwovenSilkProduct", "ZariProduct", "MetalProduct", "SkilledLabourProduct"]:
        types.new_class(n, (onto.Product,))
    rules = [
        "Product(?p), hasArtForm(?p, ?a), usesTechnique(?a, ?t), TextileTechnique(?t) -> TextileProduct(?p)",
        "Product(?p), hasArtForm(?p, ?a), usesTechnique(?a, ?t), Weaving(?t), hasMaterial(?p, ?m), Silk(?m) -> HandwovenSilkProduct(?p)",
        "Product(?p), hasMaterial(?p, ?m), Zari(?m) -> ZariProduct(?p)",
        "Product(?p), hasArtForm(?p, ?a), usesTechnique(?a, ?t), MetalCraft(?t) -> MetalProduct(?p)",
        "Product(?p), hasMaterial(?p, ?m), Metal(?m) -> MetalProduct(?p)",
        "Product(?p), hasArtForm(?p, ?a), usesTechnique(?a, ?t), requiresSkill(?t, skilled) -> SkilledLabourProduct(?p)",
    ]
    for r in rules:
        Imp().set_as_rule(r)
    random.seed(42)
    sample = sorted(random.sample(range(len(d)), 400))
    prods = {}
    for i in sample:
        p = onto.Product(f"p{i}")
        p.label = [d.product_title.iat[i]]
        p.hasArtForm = [af_ind[x] for x in d.artform_all.iat[i].split(" | ")]
        p.hasMaterial = [mat_ind[m] for m in MATERIALS if d["mat_" + m].iat[i]]
        prods[i] = p

with onto:  # inferred facts are written into this ontology, so they are saved with it
    sync_reasoner(infer_property_values=True, debug=0)   # HermiT, the same reasoner Protégé ships with

# ---------- 5. Reasoner vs pandas agreement on the sample
checks = {"TextileProduct": "kg_textile", "HandwovenSilkProduct": "kg_handwoven_silk", "ZariProduct": "kg_zari",
          "MetalProduct": "kg_metal", "SkilledLabourProduct": "kg_skilled"}
report = {}
for cls, col in checks.items():
    owl = {i for i, p in prods.items() if getattr(onto, cls) in p.is_a}
    pdx = {i for i in sample if f[col].iat[i]}
    report[cls] = dict(reasoner=len(owl), pandas=len(pdx), disagree=len(owl ^ pdx))
print(json.dumps(report, indent=1))
json.dump(report, open("reports/knowledge_graph/reasoner_vs_pandas.json", "w"), indent=1)
onto.save("tool_exports/protege/craft_kg.owl", format="rdfxml")
print("labels:", len(labels), "| mapped to a technique:", amap.technique.notna().sum(),
      "| classes:", len(list(onto.classes())), "| individuals:", len(list(onto.individuals())))
