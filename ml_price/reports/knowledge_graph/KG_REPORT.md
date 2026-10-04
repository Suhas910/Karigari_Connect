# Knowledge Graph and Rule-Based Reasoning (project parts 3–4)

**Syllabus:** Unit II (knowledge graphs, RDF triples, ontology reasoning, rule-based inference,
forward chaining, question answering) and Unit I (knowledge-based agents).

| | |
|---|---|
| **Built by** | `scripts/build_kg.py` (owlready2 0.51 + HermiT reasoner; rdflib 7.6.0 for SPARQL) |
| **Ontology file** | [`tool_exports/protege/craft_kg.owl`](../../tool_exports/protege/craft_kg.owl) (RDF/XML, opens in Protégé 5.6.9). 3,964 triples, including inferred ones |
| **Label → technique map** | [`tool_exports/protege/artform_technique_map.csv`](../../tool_exports/protege/artform_technique_map.csv) |
| **Features for models** | `data/features/kg_features.csv` (37 columns, every row) |
| **Query results** | [`sparql_results.txt`](sparql_results.txt) |

Why the ontology was generated rather than clicked together in Protégé: it has 201 art forms,
68 classes and 655 individuals. Generating it from the data is reproducible, and the `.owl` file
is the standard format Protégé opens. (Protégé access was declined during this session, so there
are no Protégé screenshots.)

## 1. Schema (TBox)

**Main classes**

| Class | What it holds |
|---|---|
| `Product` | Listings (400 sampled products as individuals) |
| `ArtForm` | 201 art-form labels from the data |
| `Technique` | Craft technique tree, rooted at `Craft` (below) |
| `Material` | Material tree (below) |
| `SkillLevel` | `skilled`, `semi_skilled` |

**Properties**

| Property | Domain → Range | Example triple |
|---|---|---|
| `hasArtForm` | Product → ArtForm | `p1234 hasArtForm af_pochampally_ikat_weaving` |
| `usesTechnique` | ArtForm → Technique | `af_pochampally_ikat_weaving usesTechnique tech_IkatWeaving` |
| `hasMaterial` | Product → Material | `p1234 hasMaterial mat_Silk` |
| `requiresSkill` | Technique → SkillLevel | inferred from class axioms (below) |

**Technique tree (excerpt)**

```
Craft
├── TextileTechnique
│   ├── Weaving ─── IkatWeaving, JamdaniWeaving
│   ├── Printing ── BlockPrinting, ScreenPrinting, DigitalPrinting
│   ├── ResistDyeing ── TieDye
│   ├── NaturalDyeing, Embroidery, Applique, YarnCraft
├── Painting ─── FolkPainting, HandPainting
├── MetalCraft ─ Enamelling, LostWaxCasting
├── WoodCraft ── WoodCarving, Lacquerware, Toymaking
├── ClayCraft ── Pottery
├── PaperCraft ─ PapierMache
├── NaturalFibreCraft ── NaturalFibreWeaving
└── Jewellery, BeadWork, LeatherCraft, StoneCraft
```

**Material tree:** Fibre (Silk, Cotton, Wool, Linen, Jute) · MetallicThread (Zari) · Metal (Brass,
Copper, Silver, Iron) · PlantMaterial (Wood, Bamboo, Paper) · EarthMaterial (Clay, Stone, Glass) ·
AnimalMaterial (Leather).

## 2. Facts (ABox) and how they were made

| Fact | Source | Method |
|---|---|---|
| Art form → technique | Art-form label text | Ordered keyword rules, first match wins. 186 of 201 labels mapped. The 15 unmapped labels are generic or regional (`handmade`, `fabart`, `plain solid`, `assamese`, `kutch`, …) and name no technique |
| Product → material | Title + description | Whole-word keyword match (e.g. `silk`, `zari`, `brass`, `terracotta`) |
| Technique → skill level | **Karigari Connect app**: `backend/app/data/technique_skill_floor.json` | Weaving, Embroidery = skilled; BlockPrinting, NaturalDyeing, Pottery, NaturalFibreWeaving = semi-skilled |

**Skill as a class axiom, not a fact per technique:** `Weaving ⊑ requiresSkill value skilled`.
The reasoner therefore passes "skilled" down to `IkatWeaving` and `JamdaniWeaving`. A first
version attached skill to the `Weaving` individual only, and missed ikat and jamdani (98 vs 103
skilled products in the sample).

## 3. Rules (SWRL) — forward chaining

| # | Rule | Meaning |
|---|---|---|
| R1 | `Product(?p) ∧ hasArtForm(?p,?a) ∧ usesTechnique(?a,?t) ∧ TextileTechnique(?t) → TextileProduct(?p)` | Any textile technique at any depth makes a textile product |
| R2 | `… ∧ Weaving(?t) ∧ hasMaterial(?p,?m) ∧ Silk(?m) → HandwovenSilkProduct(?p)` | Woven + silk |
| R3 | `Product(?p) ∧ hasMaterial(?p,?m) ∧ Zari(?m) → ZariProduct(?p)` | Metallic-thread work |
| R4 | `… MetalCraft(?t) → MetalProduct(?p)`; `… hasMaterial(?p,?m) ∧ Metal(?m) → MetalProduct(?p)` | Metal by technique *or* material |
| R5 | `… usesTechnique(?a,?t) ∧ requiresSkill(?t, skilled) → SkilledLabourProduct(?p)` | Uses a technique the app rates as skilled |

The rules chain: R5 fires only after the reasoner has inferred `requiresSkill` from the class
axiom, and R1 fires only after `IkatWeaving ⊑ Weaving ⊑ TextileTechnique` has been worked out.

## 4. Reasoner results and verification

HermiT ran on the ontology with 400 randomly sampled products (seed 42). The same rules were
applied to **all 37,257 rows** in pandas, and the two were compared on the sample:

| Inferred class | Reasoner | pandas | Disagreements |
|---|---|---|---|
| TextileProduct | 219 | 219 | 0 |
| SkilledLabourProduct | 103 | 103 | 0 |
| MetalProduct | 50 | 50 | 0 |
| ZariProduct | 19 | 19 | 0 |
| HandwovenSilkProduct | 17 | 17 | 0 |

## 5. Question answering (SPARQL over the graph)

| Question | Answers |
|---|---|
| Q1 Which art forms use any textile technique, at any depth of the tree? | 94 art forms |
| Q2 Which art forms need skilled labour (inherited)? | 53 art forms |
| Q3 Which sample products did the reasoner infer to be handwoven silk? | 17, e.g. "Green - Pure Handloom Zari Stripes Katan Silk Chanderi Saree 10" |
| Q4 How many sample products fall in each inferred class? | Table in §4 |

Q1 uses the property path `rdfs:subClassOf*`, so it finds `IkatWeaving` and `BlockPrinting` art
forms without listing them. Full queries and every answer: [`sparql_results.txt`](sparql_results.txt).

## 6. What the graph says about price (all 37,257 rows)

Median price of rows with each feature (overall median ₹850):

| Feature | Rows | Median price (₹) |
|---|---|---|
| Linen | 91 | 7,690 |
| Handwoven silk (R2) | 1,509 | 4,890 |
| Zari (R3) | 2,020 | 4,890 |
| Silk | 4,485 | 3,290 |
| Wool | 2,205 | 2,990 |
| Weaving | 7,735 | 2,850 |
| Skilled labour (R5) | 10,772 | 2,590 |
| Embroidery | 3,450 | 1,650 |
| Printing | 8,149 | 950 |
| Metal (R4) | 4,272 | 690 |
| Bead work | 1,837 | 550 |

Products the rules mark as handwoven silk, zari or skilled cost 3–6× the overall median. The
graph's categories carry real price information.

## 7. Effect on the model (experiment stage S7)

| Stage | Features | Ridge R² | Random Forest R² | Best MAE (₹) | Band F1 |
|---|---|---|---|---|---|
| S6a | labels, lengths | 0.373 | 0.110 | 1,242 | 0.551 |
| **S7-only** | S6a + 37 KG features, no word features | 0.434 | **0.527** | 975 | 0.612 |
| S6b | S6a + TF-IDF words | **0.707** | 0.602 | **730** | 0.767 |
| S7 | S6b + KG features | 0.698 | 0.586 | 749 | **0.780** |

- **Without text features**, the knowledge graph is a big gain: Random Forest R² 0.110 →
  **0.527** from 37 readable features.
- **With text features**, it adds little to regression (Ridge 0.707 → 0.698). The words already
  contain "silk", "zari", "weaving". The price-band classifier does improve (0.767 → 0.780).
- **Why keep it:** the graph's features are few and explainable ("handwoven silk", "skilled
  labour"), while 5,000 word weights aren't. That matters for explainability (part 14), for the
  advisor agent (part 16), and for listings made by voice, where there is little text.

## 8. Limits

- Technique and material links come from keywords, not from expert curation. The full mapping is
  in the CSV for review.
- Skill levels cover only the 7 techniques in the app's table. Everything else is "not rated",
  not "unskilled".
- No region or GI-tag facts were added: they need sourced references, which the dataset doesn't
  provide.
