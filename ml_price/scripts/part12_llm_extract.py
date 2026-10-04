"""Part 12 — LLM attribute extraction (Unit V: LLMs, prompt engineering).

Gemini (model from ml_price/.env, default gemini-3.5-flash) reads product titles + descriptions and
returns structured JSON: materials (fixed vocabulary), item type, set size, size text, handloom flag.
Two prompts are compared on the 80-product gold sample (reports/llm/gold_sample.csv):
  v1 zero-shot  — the task and the vocabulary only
  v2 engineered — explicit rules (tool vs material, German silver, imitation fibres) + 3 worked examples
Batches of 20 products per request; at most 12 requests per minute (free-tier limit is 15).
The API key is read from .env and never printed or logged.

Usage: python scripts/part12_llm_extract.py gold        -> run both prompts on the gold sample, score them
"""
import os, sys, json, time, pathlib
import pandas as pd
from dotenv import dotenv_values
from google import genai
from google.genai import types

ENV = dotenv_values(pathlib.Path(__file__).resolve().parents[1] / ".env")
MODEL = os.environ.get("MODEL_OVERRIDE") or ENV.get("GEMINI_MODEL") or "gemini-3.5-flash"   # MODEL_OVERRIDE: one-off runs
client = genai.Client(api_key=ENV["GEMINI_API_KEY"])
VOCAB = ["Silk", "Cotton", "Wool", "Linen", "Jute", "Zari", "Brass", "Copper", "Silver", "Iron", "Wood",
         "Bamboo", "Clay", "Stone", "Paper", "Leather", "Glass"]
SCHEMA = types.Schema(type="ARRAY", items=types.Schema(type="OBJECT", required=["id", "materials"], properties={
    "id": types.Schema(type="INTEGER"),
    "materials": types.Schema(type="ARRAY", items=types.Schema(type="STRING", enum=VOCAB)),
    "item_type": types.Schema(type="STRING"),
    "set_size": types.Schema(type="INTEGER", nullable=True),
    "size_text": types.Schema(type="STRING", nullable=True),
    "handloom": types.Schema(type="STRING", enum=["yes", "no", "unknown"])}))

PROMPT_V1 = f"""For each product below, list the materials it is made of, choosing only from: {", ".join(VOCAB)}.
Also give a short item type (e.g. "saree", "earrings"), the number of pieces if it is a set, any size or
dimension text, and whether it is handloom (yes / no / unknown). Return one JSON object per product."""

PROMPT_V2 = PROMPT_V1 + """

Rules for materials:
1. List what the PRODUCT is made of, not the TOOLS used to make it. A bamboo "kalam" pen, wooden printing
   blocks and wooden looms are tools: they do not make the product Bamboo or Wood.
2. "German silver" (GS) is a copper-nickel-zinc alloy with no silver: never list Silver for it, even if
   "silver-plated" or "silver tones" is mentioned.
3. Imitation or man-made fibres are not the real material: art silk, viscose, modal, polyester -> not Silk;
   faux / foam / artificial leather -> not Leather.
4. Processed natural fibres count: mercerised cotton -> Cotton; "silk cotton" or "chanderi silk and
   mercerised cotton blend" -> Silk and Cotton.
5. Zari: list it when the product has zari work, zari border or zari threads.
6. If a material is not in the list (fabric of unknown fibre, beads, shells, sequins, thread), leave it out.
   An empty list is allowed.

Examples:
- "Kalamkari wallet made from cotton fabric and foam leather; drawn with a kalam (a bamboo pen)" -> ["Cotton"]
- "Bagru stole, pure wool, printed with hand-carved wooden blocks" -> ["Wool"]
- "Necklace set with german silver pendant and thread work" -> []"""

def call(prompt, rows):
    items = "\n\n".join(f"[id {r.gid}] {r.product_title}\n{r.product_description}" for r in rows.itertuples())
    resp = client.models.generate_content(
        model=MODEL, contents=prompt + "\n\nProducts:\n\n" + items,
        config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=SCHEMA, temperature=0))
    return json.loads(resp.text)

def run(prompt, df, batch=20, rpm=12):
    out, last = [], 0.0
    for i in range(0, len(df), batch):
        wait = 60 / rpm - (time.time() - last)
        if wait > 0:
            time.sleep(wait)
        last = time.time()
        for attempt in range(4):
            try:
                out += call(prompt, df.iloc[i:i + batch]); break
            except Exception as e:                      # rate limit or transient error: back off, never print the key
                print(f"  batch {i // batch}: {type(e).__name__}, retrying in {20 * (attempt + 1)}s", flush=True)
                time.sleep(20 * (attempt + 1))
    return {o["id"]: o for o in out}

def score(pred_sets, gold_sets, groups):
    tp = fp = fn = exact = 0
    per_group = {}
    for p, g, grp in zip(pred_sets, gold_sets, groups):
        tp += len(p & g); fp += len(p - g); fn += len(g - p); ok = p == g; exact += ok
        per_group.setdefault(grp, []).append(ok)
    prec, rec = tp / max(tp + fp, 1), tp / max(tp + fn, 1)
    return dict(precision=round(prec, 3), recall=round(rec, 3), f1=round(2 * prec * rec / max(prec + rec, 1e-9), 3),
                exact_match=round(exact / len(gold_sets), 3), false_materials=fp, missed_materials=fn,
                exact_match_by_group={k: round(sum(v) / len(v), 3) for k, v in per_group.items()})

if __name__ == "__main__" and sys.argv[1] == "gold":
    import re
    g = pd.read_csv("reports/llm/gold_sample.csv", keep_default_na=False)
    gold = [set(s.split()) for s in g.gold_materials]
    # keyword baseline = the knowledge-graph keyword rules used in parts 3-7
    sys.path.insert(0, str(pathlib.Path(__file__).parent))
    from kg_rules import MATERIALS
    text = (g.product_title + " " + g.product_description).str.lower()
    kw = [{m for m, (_, k) in MATERIALS.items() if re.search(r"\b(?:" + "|".join(k) + r")\b", t)} for t in text]
    res = {"model": MODEL, "rows": len(g), "keywords": score(kw, gold, g.group)}
    raw = {}
    for name, prompt in [("llm_v1_zero_shot", PROMPT_V1), ("llm_v2_engineered", PROMPT_V2)]:
        t = time.time(); out = run(prompt, g)
        pred = [set(out.get(i, {}).get("materials", [])) & set(VOCAB) for i in g.gid]
        res[name] = score(pred, gold, g.group); res[name]["seconds"] = round(time.time() - t, 1)
        res[name]["missing_ids"] = [int(i) for i in g.gid if i not in out]
        raw[name] = out
        print(name, json.dumps(res[name]), flush=True)
    print("keywords", json.dumps(res["keywords"]))
    json.dump(res, open("reports/llm/part12_gold_scores.json", "w"), indent=1)
    json.dump({k: {str(i): v for i, v in o.items()} for k, o in raw.items()}, open("reports/llm/part12_gold_raw.json", "w"), indent=1)
    # side-by-side table for the report
    side = g[["gid", "group", "product_title", "gold_materials"]].copy()
    side["keywords"] = [" ".join(sorted(s)) for s in kw]
    for k in raw:
        side[k] = [" ".join(sorted(set(raw[k].get(i, {}).get("materials", [])))) for i in g.gid]
    side.to_csv("reports/llm/part12_gold_side_by_side.csv", index=False)

if __name__ == "__main__" and sys.argv[1] == "gold-v2":
    # Re-validate the engineered prompt on the gold set with another model, in 2 requests of 40.
    import re
    g = pd.read_csv("reports/llm/gold_sample.csv", keep_default_na=False)
    gold = [set(s.split()) for s in g.gold_materials]
    out = run(PROMPT_V2, g, batch=40)
    pred = [set(out.get(i, {}).get("materials", [])) & set(VOCAB) for i in g.gid]
    res = score(pred, gold, g.group); res["model"] = MODEL; res["missing_ids"] = [int(i) for i in g.gid if i not in out]
    print(json.dumps(res), flush=True)
    json.dump(res, open(f"reports/llm/part12_gold_scores_{MODEL}.json", "w"), indent=1)

if __name__ == "__main__" and sys.argv[1] == "all":
    # Every unique description (train + test). No prices are sent, so this is label-free feature
    # extraction, like fitting a text vectoriser. Engineered prompt (v2), 40 products per request,
    # progress appended to a JSONL after each request so an interrupted run resumes where it stopped.
    import os
    d = pd.read_csv("data/final/handicraft_clean.csv.gz", keep_default_na=False)
    u = d.drop_duplicates("product_description")[["product_title", "product_description"]].reset_index(drop=True)
    u.insert(0, "gid", range(len(u)))
    out_path = pathlib.Path("reports/llm/llm_attributes_unique.jsonl")   # one file; each line records its model
    done = set()
    if out_path.exists():
        done = {json.loads(l)["id"] for l in out_path.open()}
    todo = u[~u.gid.isin(done)]
    print(f"unique descriptions {len(u)} | already done {len(done)} | to do {len(todo)} | model {MODEL}", flush=True)
    BATCH, RPM, last, fails = 40, 12, 0.0, 0
    with out_path.open("a") as f:
        for i in range(0, len(todo), BATCH):
            chunk = todo.iloc[i:i + BATCH]
            wait = 60 / RPM - (time.time() - last)
            if wait > 0:
                time.sleep(wait)
            last = time.time()
            for attempt in range(5):
                try:
                    res = call(PROMPT_V2, chunk); break
                except Exception as e:
                    msg = str(e)
                    if "RESOURCE_EXHAUSTED" in msg and "per day" in msg.lower():
                        print("DAILY QUOTA REACHED — stopping; rerun later to resume", flush=True); sys.exit(2)
                    print(f"  request {i // BATCH}: {type(e).__name__}, retry in {20 * (attempt + 1)}s", flush=True)
                    time.sleep(20 * (attempt + 1))
            else:
                fails += 1; print(f"  request {i // BATCH}: gave up after 5 tries (will be retried on rerun)", flush=True); continue
            ids = set(chunk.gid)
            for r in res:
                if r.get("id") in ids:
                    r["model"] = MODEL
                    f.write(json.dumps(r) + "\n")
            f.flush()
            n = len(done) + i + len(chunk)
            if (i // BATCH) % 10 == 0:
                print(f"  {n}/{len(u)} done", flush=True)
    u[["gid", "product_description"]].to_csv("reports/llm/llm_attributes_unique_index.csv", index=False)
    print("finished; failed requests:", fails, flush=True)
