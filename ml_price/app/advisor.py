"""Price advisor agent (part 16) — decision logic, no UI.

PEAS
  Performance: honest price range that contains the market price ~80% of the time, never below the fair-wage floor
  Environment: a new handicraft listing; market prices learned from 29,805 training listings
  Actuators:   suggested range, evidence (similar listings), cautions, explanation
  Sensors:     title, description, art-form labels; optional listed price, material cost, labour hours, state, skill

Knowledge layer (rules, Unit I/II): knowledge-graph rules (kg_rules.py) + the Karigari Connect wage floor
(backend pricing_service, used read-only). Learned layer (Unit III/V): Ridge model, 80% band, FAISS retrieval.
"""
import sys, pathlib, joblib, numpy as np, pandas as pd, faiss
from sklearn.preprocessing import normalize

ROOT = pathlib.Path(__file__).resolve().parents[1]          # ml_price/
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT.parent / "backend"))
from kg_rules import kg_features, technique                  # noqa: E402

A = joblib.load(ROOT / "models/advisor.joblib")
INDEX = faiss.read_index(str(ROOT / "models/advisor_faiss.bin"))
GENERIC = {"handmade", "natural dyed", "plain solid", "handloom", "hand painted", "upcycled", "fabart"}
APP_TECHNIQUE = {"Weaving": "handloom_weave", "IkatWeaving": "handloom_weave", "JamdaniWeaving": "handloom_weave",
                 "Embroidery": "hand_embroidery", "BlockPrinting": "block_print", "NaturalDyeing": "natural_dye",
                 "Pottery": "pottery_wheel", "NaturalFibreWeaving": "bamboo_weave"}
RULE_TEXT = {"kg_textile": "textile technique (R1)", "kg_handwoven_silk": "handwoven silk (R2)", "kg_zari": "zari work (R3)",
             "kg_metal": "metal craft or metal material (R4)", "kg_skilled": "uses a technique the app rates skilled (R5)"}

def advise(title, description, labels, listed_price=None, material_cost=None, labour_hours=None,
           state_code=None, skill_level="skilled"):
    labels = [l for l in labels if l] or ["handmade"]
    row = pd.DataFrame([dict(product_title=title, product_description=description, artform_all=" | ".join(labels))])
    # --- knowledge layer: rules
    kg = kg_features(row).drop(columns="image_file").astype(float)
    facts = [RULE_TEXT[c] for c in RULE_TEXT if kg[c].iat[0] == 1]
    techs = sorted({technique(l) for l in labels} - {None})
    specific = [l for l in labels if l not in GENERIC]
    primary = specific[0] if specific else labels[0]
    if primary not in A["primary_values"]:
        primary = "other"
    # --- learned layer: segment, point estimate, range
    text = title + " " + description
    tf, sv, km = A["seg"]
    segment = "seg" + str(km.predict(normalize(sv.transform(tf.transform([text]))))[0])
    X = pd.concat([pd.DataFrame([dict(primary_artform=primary, segment=segment,
                                      artform_all=" ".join(l.replace(" ", "_") for l in labels), text=text,
                                      artform_count=len(labels), title_len=len(title), desc_len=len(description),
                                      desc_repeat=1)]), kg], axis=1)[A["cols"]]
    point = float(np.exp(A["model"].predict(X)[0]))
    low, high = point * np.exp(A["band"][0]), point * np.exp(A["band"][1])
    # --- evidence: similar listings
    q = normalize(A["retr_svd"].transform(A["retr_tf"].transform([text]))).astype("float32")
    sims, idx = INDEX.search(q, 10)
    similar = [dict(title=A["train_titles"][i], price=A["train_prices"][i], similarity=round(float(s), 3))
               for i, s in zip(idx[0], sims[0])]
    cautions = []
    if sims[0].mean() < A["low_sim"]:
        cautions.append(f"Few similar products in the data (mean similarity {sims[0].mean():.2f} < {A['low_sim']:.2f}); "
                        "errors are about 1.5× larger for products like this.")
    if primary in A["bias"] and A["bias"][primary][0] < 0.85:
        ratio, nfam = A["bias"][primary]
        cautions.append(f"The model under-prices '{primary}' on test data (median {ratio:.0%} of the real price "
                        f"across {nfam} product families). Treat the range as a lower bound.")
    # --- fair-wage floor from the Karigari Connect app (read-only), never guessed
    floor = None
    if material_cost is not None and labour_hours and state_code:
        from app.services.pricing_service import calculate_price
        app_t = sorted({APP_TECHNIQUE[t] for t in techs if t in APP_TECHNIQUE})
        r = calculate_price(material_cost_inr=material_cost, labour_hours=labour_hours, state_code=state_code,
                            skill_level=skill_level, techniques=app_t)
        floor = dict(status=r.status, amount=r.floor_amount_inr, explanation=r.explanation, techniques=app_t)
    final_low, final_high = low, high
    if floor and floor["status"] == "available":
        final_low, final_high = max(low, floor["amount"]), max(high, floor["amount"])
        if high < floor["amount"]:
            cautions.append("The whole market range is below the fair-wage floor: market prices for this item don't "
                            "cover the labour. The suggestion is raised to the floor.")
    verdict = None
    if listed_price:
        if floor and floor["status"] == "available" and listed_price < floor["amount"]:
            verdict = "Listed price is BELOW the fair-wage floor."
        elif listed_price < 0.5 * point:
            verdict = "Listed price is under half of the market estimate: possible underpricing, worth a review."
        elif listed_price > 2 * point:
            verdict = "Listed price is over double the market estimate."
        else:
            verdict = "Listed price is within the normal market range."
    return dict(primary_artform=primary, segment=segment, techniques=techs, rule_facts=facts,
                point=round(point, -1), market_range=(round(low, -1), round(high, -1)),
                suggested_range=(round(final_low, -1), round(final_high, -1)),
                floor=floor, similar=similar, cautions=cautions, verdict=verdict)

if __name__ == "__main__":
    import json
    r = advise("Red - Handloom Mulberry Silk Ikat Saree with Zari Border",
               "Handwoven pure mulberry silk saree in Pochampally ikat with zari border. Each piece is woven by hand.",
               ["pochampally ikat weaving", "handloom"], listed_price=4500,
               material_cost=3000, labour_hours=40, state_code="TG")
    print(json.dumps(r, indent=1, default=str))
