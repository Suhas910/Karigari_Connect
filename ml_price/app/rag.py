"""Part 18 — retrieval-augmented generation (Unit V: RAG, LLMs, prompt engineering, vector databases).

Retrieval: the FAISS index returns the most similar TRAINING listings with their real prices.
Augmentation: those listings are placed in the prompt as numbered evidence.
Generation: Gemini returns a price estimate, a range, the listing numbers it relied on, how good the
matches are, and a one-sentence reason. Only the evidence may be used (grounding rule).

The API key is read from ml_price/.env and never printed or logged. No test-set price is ever sent.
"""
import os, json, pathlib
from dotenv import dotenv_values
from google import genai
from google.genai import types

ENV = dotenv_values(pathlib.Path(__file__).resolve().parents[1] / ".env")
MODEL = os.environ.get("MODEL_OVERRIDE") or "gemini-3.5-flash-lite"
_client = None

def client():
    global _client
    if _client is None:
        _client = genai.Client(api_key=ENV["GEMINI_API_KEY"])
    return _client

SCHEMA = types.Schema(type="ARRAY", items=types.Schema(type="OBJECT",
    required=["id", "estimate", "low", "high", "cited", "match_quality", "reason"], properties={
        "id": types.Schema(type="INTEGER"),
        "estimate": types.Schema(type="INTEGER"),
        "low": types.Schema(type="INTEGER"),
        "high": types.Schema(type="INTEGER"),
        "cited": types.Schema(type="ARRAY", items=types.Schema(type="INTEGER")),
        "match_quality": types.Schema(type="STRING", enum=["good", "partial", "poor"]),
        "reason": types.Schema(type="STRING")}))

RAG_PROMPT = """You price Indian handicraft products for an online catalogue.
For each product you get numbered SIMILAR LISTINGS from the same catalogue, with their prices in rupees.
Rules:
1. Use ONLY the similar listings as evidence. Do not use outside knowledge of prices.
2. Give a point estimate and a low-high range in whole rupees. The range should hold the true price
   about 80% of the time.
3. "cited" = the listing numbers your estimate mainly relies on (closest in item type, size, material,
   set size). Ignore listings that are a different kind of item.
4. match_quality: good if several listings are the same kind of item, partial if only similar,
   poor if none really match. When poor, widen the range.
5. reason: one sentence a seller would understand, naming what the cited listings have in common."""

NO_RAG_PROMPT = """You price Indian handicraft products for an online catalogue.
For each product, give a point estimate and a low-high range in whole rupees (the range should hold
the true price about 80% of the time), using your general knowledge of Indian handicraft retail prices.
Set "cited" to an empty list and match_quality to "poor". reason: one sentence."""

def _block(i, p, with_evidence):
    s = f"### Product {i}\nTitle: {p['title']}\nDescription: {p['description'][:600]}"
    if with_evidence:
        s += "\nSIMILAR LISTINGS:\n" + "\n".join(
            f"  [{j + 1}] ₹{n['price']:,} | {n['title']}" for j, n in enumerate(p["neighbours"]))
    return s

def estimate(products, with_evidence=True):
    """products: list of dicts with title, description and (for RAG) neighbours=[{title, price}].
    Returns one dict per product, in order (None where the model gave no answer)."""
    prompt = (RAG_PROMPT if with_evidence else NO_RAG_PROMPT) + "\n\nReturn one JSON object per product, " \
             "with id = the product number.\n\n" + "\n\n".join(_block(i, p, with_evidence) for i, p in enumerate(products))
    resp = client().models.generate_content(model=MODEL, contents=prompt, config=types.GenerateContentConfig(
        response_mime_type="application/json", response_schema=SCHEMA, temperature=0))
    by_id = {o["id"]: o for o in json.loads(resp.text)}
    return [by_id.get(i) for i in range(len(products))]
