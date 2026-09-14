# backend/app/ai/gemini_client.py
"""
Legacy demo content, served when CRAFTLINK_IMAGE, CRAFTLINK_ASR or CRAFTLINK_CATALOGUE
is `legacy`.

Nothing here calls a model. It used to, and that was worse than calling none:

- The photo audit sent a URL string, never the image, and asked for grades.
- The transcription sent a URL string, never the audio, and asked the model to "generate a
  realistic craft transcription" with a confidence between 0.85 and 0.99.
- Every call used `gemini-2.5-flash`, which returns 404 for new API keys (checked
  2026-09-14), and any error fell back to the content below with nothing saying so.

So these return fixed demo content, and the service labels every result built from it
with `adapter.provider: "fixture"`. The real paths are `adapters/gemini_asr.py`,
`adapters/gemini_catalogue.py`, `vision/` and `adapters/gemini_photo.py`.
"""
from typing import Any, Dict

DEMO_NOTICE = "Demo content. It was not made from this listing's photo, recording or description."


class GeminiClient:
    def __init__(self):
        # Kept for callers that check it. There is no client: no request is ever made.
        self.client = None

    def audit_image_quality(self, image_url: str) -> Dict[str, Any]:
        """Fixed grades. The photo is not opened, so there is no guidance to give."""
        return {
            "blur": "low",
            "lighting": "acceptable",
            "framing": "acceptable",
            "overall": "acceptable",
            "guidance": [],
        }

    def transcribe_and_translate(self, audio_url_or_id: str, declared_language: str = "kn") -> Dict[str, Any]:
        """A fixed transcript per language. The recording is not opened."""
        fixtures = {
            "kn": {
                "transcript": "ಇದು ಸಾಂಪ್ರದಾಯಿಕ ಚೆನ್ನಪಟ್ಟಣ ಕೈಕೆತ್ತನೆಯ ಮರದ ಆಟಿಕೆ. ಆಲೇಮರ ಮತ್ತು ನೈಸರ್ಗಿಕ ತರಕಾರಿ ಬಣ್ಣಗಳನ್ನು ಬಳಸಿ ಲೇತ್ ಯಂತ್ರದಲ್ಲಿ ಮಾಡಲಾಗಿದೆ. ಪೂರ್ಣಗೊಳಿಸಲು 6 ಗಂಟೆ ಶ್ರಮ ಬೇಕಾಯಿತು.",
                "translated_text": "This is a traditional Channapatna hand-turned wooden craft toy. Made using ivory wood (Aale mara) and non-toxic natural vegetable dyes on a traditional lathe. Took 6 hours of skilled artisanal labor.",
                "asr_confidence": 0.94,
                "detected_language": "kn"
            },
            "hi": {
                "transcript": "यह शुद्ध हाथकरघा बनारसी रेशम साड़ी है। इसमें पारंपरिक कधुआ बुनाई और असली जरी की नक्काशी की गई है। इसे तैयार करने में 14 घंटे की बारीक मेहनत लगी है।",
                "translated_text": "This is a pure handloom Banarasi silk saree with authentic Kadhuwa weave and pure zari embroidery. Handcrafted with 14 hours of master weaver labor.",
                "asr_confidence": 0.96,
                "detected_language": "hi"
            },
            "en": {
                "transcript": "Authentic handcrafted Bidriware metal vase with pure silver inlay on blackened zinc and copper alloy. Requires 8 hours of delicate engraving and soil oxidation.",
                "translated_text": "Authentic handcrafted Bidriware metal vase with pure silver inlay on blackened zinc and copper alloy. Requires 8 hours of delicate engraving and soil oxidation.",
                "asr_confidence": 0.98,
                "detected_language": "en"
            }
        }
        return fixtures.get(declared_language, fixtures["kn"])

    def extract_catalogue_metadata(self, description_text: str, declared_language: str = "kn") -> Dict[str, Any]:
        """A fixed catalogue per language. The description is not read."""
        if declared_language == "hi":
            return {
                "category": "Handloom Textiles",
                "materials": ["Pure Mulberry Silk", "Gold Zari Thread", "Natural Dyes"],
                "techniques": ["Kadhuwa Pit Loom Weaving", "Hand Jacquard Motif"],
                "title_en": "Pure Handloom Banarasi Katan Silk Saree",
                "title_local": "शुद्ध हथकरघा बनारसी कतान रेशम साड़ी",
                "description_en": "Handwoven pure Banarasi silk saree featuring traditional Kadhuwa motifs and gold zari border. Directly woven by master weavers preserving centuries-old heritage.",
                "description_local": "मास्टर बुनकरों द्वारा हथकरघे पर तैयार शुद्ध बनारसी कतान रेशम साड़ी, जिसमें पारंपरिक कधुआ रूपांकन और सोने की जरी का काम है।",
                "labour_hours": 14.0,
                "skill_level": "master_artisan",
                "material_cost_paise": 320000,
                "claims": [
                    {"claim": "handloom_weave", "asserted_by_artisan": True, "coordinator_verified": False, "evidence_note": None}
                ],
                "gi_tag": None,
                "field_confidence": {
                    "category": 0.98,
                    "materials": 0.94,
                    "techniques": 0.91,
                    "title": 0.96,
                    "description": 0.93,
                    "labour.hours": 0.89,
                    "material_cost_paise": 0.80  # < 0.85 prompts confirmation
                }
            }
        return {
            "category": "Woodcraft & Toys",
            "materials": ["Ivory Wood (Aale Mara)", "Vegetable Lacquer Dye"],
            "techniques": ["Lathe Turning", "Natural Lacquer Polishing"],
            "title_en": "Channapatna Handcrafted Natural Lacquer Toy",
            "title_local": "ಚೆನ್ನಪಟ್ಟಣ ನೈಸರ್ಗಿಕ ಬಣ್ಣದ ಸಾಂಪ್ರದಾಯಿಕ ಮರದ ಆಟಿಕೆ",
            "description_en": "Authentic Channapatna wooden toy handcrafted on a traditional lathe using seasoned ivory wood and non-toxic natural vegetable lacquers. Safe for children and eco-friendly.",
            "description_local": "ಸಾಂಪ್ರದಾಯಿಕ ಲೇತ್ ಯಂತ್ರದಲ್ಲಿ ನೈಸರ್ಗಿಕ ಬಣ್ಣಗಳನ್ನು ಬಳಸಿ ತಯಾರಿಸಿದ ಅಧಿಕೃತ ಚೆನ್ನಪಟ್ಟಣ ಮರದ ಆಟಿಕೆ. ಮಕ್ಕಳಿಗೆ ಸುರಕ್ಷಿತ ಮತ್ತು ಪರಿಸರ ಸ್ನೇಹಿ.",
            "labour_hours": 6.0,
            "skill_level": "skilled",
            "material_cost_paise": 45000,
            "claims": [
                {"claim": "natural_dye", "asserted_by_artisan": True, "coordinator_verified": False, "evidence_note": None}
            ],
            "gi_tag": None,
            "field_confidence": {
                "category": 0.97,
                "materials": 0.93,
                "techniques": 0.91,
                "title": 0.95,
                "description": 0.92,
                "labour.hours": 0.88,
                "material_cost_paise": 0.82  # < 0.85 prompts confirmation
            }
        }


gemini_client = GeminiClient()
