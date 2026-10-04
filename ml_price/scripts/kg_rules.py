"""Knowledge-graph rules shared by build_kg.py (training data) and the demo (new products).
technique(label) -> technique class; kg_features(df) -> the 37 rule-derived feature columns."""
import pandas as pd

# 1. Technique taxonomy and art-form -> technique mapping (keyword rules, first match wins)
TECH_RULES = [  # (technique class, parent class, keywords in the art-form label)
    ("IkatWeaving", "Weaving", ["ikat", "patola"]),
    ("JamdaniWeaving", "Weaving", ["jamdani"]),
    ("NaturalFibreWeaving", "NaturalFibreCraft", ["grass weaving", "jute weaving", "raffia weaving", "madur", "sitalpati"]),
    ("Weaving", "TextileTechnique", ["weaving", "weaves", "handloom", "kupaddam", "khun", "doria"]),
    ("BlockPrinting", "Printing", ["block printing"]),
    ("ScreenPrinting", "Printing", ["screen printing", "jaipur printing"]),
    ("DigitalPrinting", "Printing", ["digital printing"]),
    ("TieDye", "ResistDyeing", ["tie dye", "bandhani", "shibori", "lehariya"]),
    ("NaturalDyeing", "TextileTechnique", ["natural dyed"]),
    ("Embroidery", "TextileTechnique", ["embroidery", "chikankari", "phulkari", "kantha", "kashida", "thread work",
                                        "running stitch", "gota", "tagai", "pintuck", "sewing"]),
    ("Applique", "TextileTechnique", ["applique", "patchwork"]),
    ("YarnCraft", "TextileTechnique", ["crochet", "knitted", "macrame", "braided", "felt"]),
    ("FolkPainting", "Painting", ["folk art", "mural", "miniature", "kalamkari", "pattachitra", "tikuli", "lippan",
                                  "mandala", "mandana", "sanjhi", "rogan", "paintings", "art work"]),
    ("HandPainting", "Painting", ["hand painted", "handpainted"]),
    ("Enamelling", "MetalCraft", ["enamel", "meenakari"]),
    ("LostWaxCasting", "MetalCraft", ["dokra"]),
    ("MetalCraft", "Craft", ["metal", "brass", "copper", "bell", "wrought iron", "filigree", "silver", "tarkashi", "wire"]),
    ("Jewellery", "Craft", ["jewel"]),
    ("BeadWork", "Craft", ["bead"]),
    ("WoodCarving", "WoodCraft", ["wood carving"]),
    ("Lacquerware", "WoodCraft", ["lacquer", "lac"]),
    ("Toymaking", "WoodCraft", ["toy", "puppet", "bobblehead"]),
    ("Pottery", "ClayCraft", ["pottery", "terracotta"]),
    ("PapierMache", "PaperCraft", ["papier mache", "paper mache"]),
    ("PaperCraft", "Craft", ["stationery", "quilling"]),
    ("LeatherCraft", "Craft", ["leather"]),
    ("StoneCraft", "Craft", ["stone"]),
    ("NaturalFibreCraft", "Craft", ["bamboo", "grass", "coir", "hyacinth", "palm", "coconut", "seashell", "seed",
                                    "paddy", "tuma", "flower", "sabai", "sikki"]),
]
TEXTILE_PARENTS = {"Weaving": "TextileTechnique", "Printing": "TextileTechnique", "ResistDyeing": "TextileTechnique"}
OTHER_PARENTS = {"Painting": "Craft", "WoodCraft": "Craft", "ClayCraft": "Craft", "TextileTechnique": "Craft"}
# Skill floor from the Karigari Connect app (backend/app/data/technique_skill_floor.json)
SKILL = {"Weaving": "skilled", "Embroidery": "skilled", "BlockPrinting": "semi_skilled",
         "NaturalDyeing": "semi_skilled", "Pottery": "semi_skilled", "NaturalFibreWeaving": "semi_skilled"}

def technique(label):
    for cls, _, kws in TECH_RULES:
        if any(k in label for k in kws):
            return cls
    return None  # generic or regional label with no technique (e.g. handmade, fabart, assamese)


# 2. Materials from title + description (keyword dictionary)
MATERIALS = {  # class: (parent, keywords)
    "Silk": ("Fibre", ["silk"]), "Cotton": ("Fibre", ["cotton"]), "Wool": ("Fibre", ["wool", "pashmina"]),
    "Linen": ("Fibre", ["linen"]), "Jute": ("Fibre", ["jute"]),
    "Zari": ("MetallicThread", ["zari"]),
    "Brass": ("Metal", ["brass"]), "Copper": ("Metal", ["copper"]), "Silver": ("Metal", ["silver"]),
    "Iron": ("Metal", ["iron"]),
    "Wood": ("PlantMaterial", ["wood", "wooden"]), "Bamboo": ("PlantMaterial", ["bamboo"]),
    "Clay": ("EarthMaterial", ["terracotta", "clay", "ceramic"]), "Stone": ("EarthMaterial", ["stone", "marble"]),
    "Paper": ("PlantMaterial", ["paper"]), "Leather": ("AnimalMaterial", ["leather"]),
    "Glass": ("EarthMaterial", ["glass"]),
}

def kg_features(d):
    """d needs columns product_title, product_description, artform_all (labels joined by ' | ')."""
    d = d.copy()
    text = (d.product_title + " " + d.product_description).str.lower()
    for m, (_, kws) in MATERIALS.items():
        d["mat_" + m] = text.str.contains(r"\b(?:" + "|".join(kws) + r")\b", regex=True)
    # 3. Rules, applied in pandas to every row
    techs = d.artform_all.map(lambda s: {technique(x) for x in s.split(" | ")} - {None})
    def parents(t):
        out = {t}
        for cls, par, _ in TECH_RULES:
            if cls == t:
                out.add(par)
        for _ in range(3):
            out |= {TEXTILE_PARENTS.get(x) or OTHER_PARENTS.get(x) for x in out} - {None}
        return out
    anc = techs.map(lambda ts: set().union(*[parents(t) for t in ts]) if ts else set())
    f = pd.DataFrame({"image_file": d.image_file if "image_file" in d else d.index})
    f["kg_textile"] = anc.map(lambda a: "TextileTechnique" in a)                                    # rule R1
    f["kg_handwoven_silk"] = anc.map(lambda a: "Weaving" in a) & d.mat_Silk                         # rule R2
    f["kg_zari"] = d.mat_Zari                                                                       # rule R3
    f["kg_metal"] = anc.map(lambda a: "MetalCraft" in a) | d.mat_Brass | d.mat_Copper | d.mat_Silver | d.mat_Iron  # R4
    f["kg_skilled"] = anc.map(lambda a: any(SKILL.get(t) == "skilled" for t in a))                  # rule R5 (inherits down the class tree)
    f["kg_n_techniques"] = techs.map(len)
    for g in ["Weaving", "Printing", "ResistDyeing", "Embroidery", "Painting", "MetalCraft", "WoodCraft",
              "ClayCraft", "PaperCraft", "NaturalFibreCraft", "Jewellery", "BeadWork", "YarnCraft", "Applique"]:
        f["kg_tech_" + g] = anc.map(lambda a, g=g: g in a)
    for m in MATERIALS:
        f["kg_mat_" + m] = d["mat_" + m]
    return f
