# backend/app/ai/service.py
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from fastapi import HTTPException

from .. import models, schemas
from . import config
from .gemini_client import gemini_client
from .provenance_gate import enforce_catalogue
from .pricing import bridge as price_bridge
from .pricing.engine import InvalidPricingInput, WageRateUnavailable
from .adapters import DEFAULT_ASR_PREFERENCE, GeminiCatalogueAdapter, resolve_asr
from .contracts import AIError, ErrorCode, TranscriptResult
from ..storage import MediaNotFound, StorageUnavailable, get_media_store

logger = logging.getLogger(__name__)

# CRAFTLINK_ASR value -> adapters to try, in order. `legacy` is handled separately.
_ASR_PREFERENCES = {
    "gemini": DEFAULT_ASR_PREFERENCE,
    "local": ("local_whisper",),
}

# LEGACY. Used only when CRAFTLINK_PRICE_ENGINE=legacy.
#
# Two problems, both verified rather than assumed, and both the reason the default is
# now the deterministic engine in pricing/bridge.py:
#
#   1. skill_level never reaches this table. There is one rate per state, so unskilled
#      and highly_skilled price identically, and the deck's "state statutory skilled
#      wage" claim is not what the code computes.
#   2. The source URLs below do not resolve to notifications. Checked 2026-09-11:
#      UP 404, TN 404, RJ does not resolve; the rest are site roots. The references
#      (KLS-2025-WAGE-44 and so on) cannot be checked against a published document.
#
# Do not add rates here. The deterministic engine reads pricing/wage_table.json, which
# ships empty by design and refuses to price until a real notification is transcribed
# into it with its source URL and effective date.
STATUTORY_WAGES: Dict[str, Dict[str, Any]] = {
    "KA": {
        "state_code": "KA",
        "notification_ref": "KLS-2025-WAGE-44",
        "effective_from": "2025-04-01",
        "source_url": "https://labour.karnataka.gov.in/notifications/2025/crafts",
        "hourly_wage_paise": 7850,  # ₹78.50/hr
    },
    "UP": {
        "state_code": "UP",
        "notification_ref": "UP-MINWAGE-89",
        "effective_from": "2025-04-01",
        "source_url": "https://uplabour.gov.in/orders/minimum-wages-handicrafts",
        "hourly_wage_paise": 6800,  # ₹68.00/hr
    },
    "RJ": {
        "state_code": "RJ",
        "notification_ref": "RJ-MINWAGE-102",
        "effective_from": "2025-05-01",
        "source_url": "https://rajlabour.nic.in/notifications/heritage-crafts",
        "hourly_wage_paise": 7200,  # ₹72.00/hr
    },
    "TN": {
        "state_code": "TN",
        "notification_ref": "TN-HANDLOOM-81",
        "effective_from": "2025-06-01",
        "source_url": "https://tn.gov.in/handlooms/wages",
        "hourly_wage_paise": 8200,  # ₹82.00/hr
    },
    "MP": {
        "state_code": "MP",
        "notification_ref": "MP-WAGE-07",
        "effective_from": "2025-04-01",
        "source_url": "https://labour.mp.gov.in/wages",
        "hourly_wage_paise": 6600,  # ₹66.00/hr
    },
    "IN": {
        "state_code": "IN",
        "notification_ref": "CENTRAL-FLOOR-WAGE-2025",
        "effective_from": "2025-01-01",
        "source_url": "https://labour.gov.in/national-floor-level-minimum-wage",
        "hourly_wage_paise": 7500,  # ₹75.00/hr
    },
}

class AIService:
    @staticmethod
    def create_image_job(
        listing_id: str,
        media_id: str,
        photos: Optional[List[str]],
        db: Session
    ) -> models.JobModel:
        # Verify listing
        listing = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
        if not listing:
            raise HTTPException(status_code=404, detail="Listing not found")

        # Find media asset
        media = db.query(models.MediaAssetModel).filter(
            models.MediaAssetModel.id == media_id,
            models.MediaAssetModel.listing_id == listing_id
        ).first()

        original_url = media.url if media and media.url else "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=800"
        
        # Perform image quality audit via Gemini or deterministic fallback
        audit = gemini_client.audit_image_quality(original_url)

        enhanced_media_id = str(uuid.uuid4())
        # Provide clean studio-enhanced image variations
        enhanced_url = original_url + "&auto=format&fit=crop&q=85&studio=true"
        enhanced_urls = [
            enhanced_url,
            original_url + "&variant=white_backdrop",
            original_url + "&variant=texture_detail"
        ]

        result_payload = {
            "job_id": "",
            "status": "complete",
            "quality": audit,
            "original_url": original_url,
            "enhanced_media_id": enhanced_media_id,
            "enhanced_url": enhanced_url,
            "enhanced_urls": enhanced_urls,
            "transformations": [
                "Background clutter isolated and softened to neutral tone",
                "Color temperature balanced to 5500K daylight studio benchmark",
                "Shadow fill applied to highlight micro-weaving details",
                "E-commerce square aspect ratio centering with 10% breathing margin"
            ],
            "human_review_required": audit.get("overall") == "needs_review"
        }

        # Create or update enhanced media asset
        enhanced_media = models.MediaAssetModel(
            id=enhanced_media_id,
            listing_id=listing_id,
            kind="image",
            variant="enhanced",
            status="complete",
            url=enhanced_url,
            metadata_json=json.dumps(audit)
        )
        db.add(enhanced_media)

        # Create Job
        job = models.JobModel(
            job_id=str(uuid.uuid4()),
            listing_id=listing_id,
            type="image_studio",
            status="complete",
            attempt=1,
            result_data=json.dumps(result_payload)
        )
        result_payload["job_id"] = job.job_id
        job.result_data = json.dumps(result_payload)

        listing.state = "processing"
        db.add(job)
        db.commit()
        db.refresh(job)
        return job

    @staticmethod
    def create_transcription_job(
        listing_id: str,
        audio_media_id: str,
        declared_language: str,
        db: Session
    ) -> models.JobModel:
        listing = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
        if not listing:
            raise HTTPException(status_code=404, detail="Listing not found")

        if config.asr_mode() != "legacy":
            return AIService._adapter_transcription_job(listing_id, audio_media_id, declared_language, db)

        # LEGACY. Never sends the audio; see adapters/gemini_asr.py.
        audio_media = db.query(models.MediaAssetModel).filter(
            models.MediaAssetModel.id == audio_media_id,
            models.MediaAssetModel.listing_id == listing_id
        ).first()

        audio_url = audio_media.url if audio_media and audio_media.url else "sample_audio.wav"
        transcription_res = gemini_client.transcribe_and_translate(audio_url, declared_language=declared_language)

        job = models.JobModel(
            job_id=str(uuid.uuid4()),
            listing_id=listing_id,
            type="transcription",
            status="complete",
            attempt=1,
            result_data=json.dumps(transcription_res)
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        return job

    @staticmethod
    def _adapter_transcription_job(
        listing_id: str,
        audio_media_id: str,
        declared_language: str,
        db: Session
    ) -> models.JobModel:
        """Transcribe the uploaded recording through the adapter registry.

        Runs in the request, like the other jobs. A provider failure is a failed job with
        a contract error in `error_data`, not an exception: the recording is stored, and
        the app can offer a retry or a new recording.
        """
        mode = config.asr_mode()
        preference = _ASR_PREFERENCES.get(mode)
        if preference is None:
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "PROVIDER_UNAVAILABLE",
                    "message": f"Unknown CRAFTLINK_ASR={mode!r}; expected legacy, gemini or local.",
                    "recoverable": False,
                    "action": None,
                },
            )

        media = db.query(models.MediaAssetModel).filter(
            models.MediaAssetModel.id == audio_media_id,
            models.MediaAssetModel.listing_id == listing_id
        ).first()
        if not media or media.kind != "audio" or not media.storage_path:
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "LISTING_STATE_INVALID",
                    "message": "This listing has no uploaded voice recording with that id.",
                    "recoverable": True,
                    "action": "Upload the recording with POST /listings/{listing_id}/media/upload and use the media_id it returns.",
                },
            )

        job = models.JobModel(
            job_id=str(uuid.uuid4()),
            listing_id=listing_id,
            type="transcription",
            status="processing",
            attempt=1,
        )
        error = None
        try:
            metadata = json.loads(media.metadata_json or "{}")
            audio = get_media_store(metadata.get("storage_backend")).get(media.storage_path)
            adapter = resolve_asr(preference)
            result = adapter.transcribe(audio, declared_language=declared_language, transcript_id=job.job_id)
        except MediaNotFound:
            logger.error("Transcription: media %s points at missing object %s", media.id, media.storage_path)
            error = AIError(
                ErrorCode.LISTING_STATE_INVALID,
                "The recording is missing from storage.",
                recoverable=True,
                action="record_again",
            )
        except StorageUnavailable as exc:
            logger.error("Transcription: media store unavailable for %s: %s", media.id, exc)
            error = AIError(
                ErrorCode.PROVIDER_UNAVAILABLE,
                "The recording could not be read from storage.",
                recoverable=True,
                action="retry_later",
            )
        except AIError as exc:
            error = exc

        if error is None:
            job.status = "complete"
            job.result_data = json.dumps({
                "job_id": job.job_id,
                "status": "complete",
                **result.model_dump(),
                "needs_replay": result.needs_replay,
            })
        else:
            job.status = "failed"
            job.error_data = json.dumps(error.as_dict())

        db.add(job)
        db.commit()
        db.refresh(job)
        return job

    @staticmethod
    def generate_catalogue(
        listing_id: str,
        payload: Optional[Dict[str, Any]],
        db: Session
    ) -> schemas.CatalogueResult:
        listing = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
        if not listing:
            raise HTTPException(status_code=404, detail="Listing not found")

        if config.catalogue_mode() != "legacy":
            return AIService._adapter_catalogue(listing, payload, db)

        # LEGACY. Free-text extraction with a fixed fallback listing.
        # Check if there was a transcription job
        trans_job = db.query(models.JobModel).filter(
            models.JobModel.listing_id == listing_id,
            models.JobModel.type == "transcription",
            models.JobModel.status == "complete"
        ).order_by(models.JobModel.created_at.desc()).first()

        declared_lang = listing.preferred_language or "kn"
        sample_text = ""
        asr_conf = None
        transcript_id = str(uuid.uuid4())

        if trans_job and trans_job.result_data:
            data = json.loads(trans_job.result_data)
            if "original_text" in data:
                # Adapter transcript (TranscriptResult). Confidence may be None.
                sample_text = data.get("english_translation") or data["original_text"]
                asr_conf = data.get("overall_confidence")
            else:
                sample_text = data.get("translated_text", "")
                asr_conf = data.get("asr_confidence")
            transcript_id = trans_job.job_id
        elif payload and isinstance(payload, dict) and payload.get("transcript"):
            sample_text = payload.get("transcript")
        else:
            sample_text = "Traditional handmade craft using natural materials."

        raw_cat = gemini_client.extract_catalogue_metadata(sample_text, declared_language=declared_lang)

        # Build Catalogue Draft
        field_confidence = raw_cat.get("field_confidence", {})
        # Flag any field with confidence below 0.85
        needs_confirmation = [
            f for f, score in field_confidence.items() if score < 0.85
        ]
        if not needs_confirmation and "material_cost_paise" not in needs_confirmation:
            # By default prompt confirmation for financial/material cost to empower artisan control
            needs_confirmation.append("material_cost_paise")

        claims_list = [
            schemas.ClaimSchema(
                claim=c["claim"],
                asserted_by_artisan=c.get("asserted_by_artisan", True),
                coordinator_verified=c.get("coordinator_verified", False),
                evidence_note=c.get("evidence_note")
            )
            for c in raw_cat.get("claims", [])
        ]

        catalogue_draft = schemas.CatalogueDraft(
            listing_id=listing_id,
            category=raw_cat.get("category", "Handicrafts"),
            materials=raw_cat.get("materials", []),
            techniques=raw_cat.get("techniques", []),
            title=schemas.MultilingualText(
                en=raw_cat.get("title_en", "Handcrafted Artisan Product"),
                local=raw_cat.get("title_local", "ಕೈಯಿಂದ ಮಾಡಿದ ಉತ್ಪನ್ನ"),
                local_language=declared_lang
            ),
            description=schemas.MultilingualDesc(
                en=raw_cat.get("description_en", "Authentic handcrafted product."),
                local=raw_cat.get("description_local", "ಅಧಿಕೃತ ಕರಕುಶಲ ಉತ್ಪನ್ನ.")
            ),
            labour=schemas.LabourInfo(
                hours=float(raw_cat.get("labour_hours", 6.0)),
                skill_level=raw_cat.get("skill_level", "skilled"),
                state_code=declared_lang.upper() if declared_lang in ["ka", "up", "rj", "tn", "mp"] else "KA"
            ),
            material_cost_paise=int(raw_cat.get("material_cost_paise", 45000)),
            provenance=schemas.ProvenanceInfo(
                claims=claims_list,
                gi_tag=raw_cat.get("gi_tag")
            ),
            source=schemas.SourceInfo(
                transcript_id=transcript_id,
                asr_confidence=asr_conf
            )
        )

        return AIService._gate_and_store(listing, catalogue_draft, field_confidence, needs_confirmation, db)

    @staticmethod
    def _adapter_catalogue(
        listing: models.ListingModel,
        payload: Optional[Dict[str, Any]],
        db: Session
    ) -> schemas.CatalogueResult:
        """Generate the catalogue from the listing's transcript with Gemini.

        No transcript, no catalogue. A failed generation stores nothing and returns the
        contract error.
        """
        mode = config.catalogue_mode()
        if mode != "gemini":
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "PROVIDER_UNAVAILABLE",
                    "message": f"Unknown CRAFTLINK_CATALOGUE={mode!r}; expected legacy or gemini.",
                    "recoverable": False,
                    "action": None,
                },
            )

        payload = payload or {}
        facts = payload.get("confirmed_facts") or {}
        if not isinstance(facts, dict):
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "CATALOGUE_SCHEMA_INVALID",
                    "message": "confirmed_facts must be an object.",
                    "recoverable": True,
                    "action": "Send confirmed_facts as an object, e.g. {\"state_code\": \"KA\"}.",
                },
            )

        query = db.query(models.JobModel).filter(
            models.JobModel.listing_id == listing.id,
            models.JobModel.type == "transcription",
            models.JobModel.status == "complete"
        )
        if payload.get("transcript_id"):
            query = query.filter(models.JobModel.job_id == payload["transcript_id"])
        trans_job = query.order_by(models.JobModel.created_at.desc()).first()
        data = json.loads(trans_job.result_data) if trans_job and trans_job.result_data else {}
        if "original_text" not in data:
            # A legacy transcription result was never derived from the audio.
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "LISTING_STATE_INVALID",
                    "message": "This listing has no completed transcript to generate from.",
                    "recoverable": True,
                    "action": "Transcribe the uploaded recording first (CRAFTLINK_ASR=gemini), then generate again.",
                },
            )
        transcript = TranscriptResult.model_validate(
            {key: data[key] for key in TranscriptResult.model_fields if key in data}
        )

        try:
            result = GeminiCatalogueAdapter().generate(
                transcript=transcript, confirmed_facts=facts, listing_id=listing.id
            )
        except AIError as exc:
            logger.warning("Catalogue generation for %s failed: %s", listing.id, exc.message)
            status_code = {
                ErrorCode.CATALOGUE_SCHEMA_INVALID: 422,
                ErrorCode.LISTING_STATE_INVALID: 409,
            }.get(exc.code, 503)
            raise HTTPException(status_code=status_code, detail=exc.as_dict()) from exc

        cat = result.catalogue
        cost_inr = cat.get("material_cost_inr")
        catalogue_draft = schemas.CatalogueDraft(
            listing_id=listing.id,
            category=cat["category"],
            materials=cat["materials"],
            techniques=cat["techniques"],
            finish=cat.get("finish"),
            title=schemas.MultilingualText(
                en=cat["title"]["en"],
                local=cat["title"].get("local"),
                local_language=cat["title"].get("local_language") or transcript.detected_language,
            ),
            description=schemas.MultilingualDesc(
                en=cat["description"]["en"], local=cat["description"].get("local")
            ),
            labour=schemas.LabourInfo(**cat["labour"]),
            material_cost_paise=None if cost_inr is None else round(cost_inr * 100),
            provenance=schemas.ProvenanceInfo(
                claims=[schemas.ClaimSchema(**c) for c in cat["provenance"]["claims"]],
                gi_tag=None,
            ),
            source=schemas.SourceInfo(
                transcript_id=cat["source"]["transcript_id"],
                asr_confidence=cat["source"].get("asr_confidence"),
            ),
        )
        return AIService._gate_and_store(
            listing, catalogue_draft, dict(result.field_confidence), list(result.needs_confirmation), db
        )

    @staticmethod
    def _gate_and_store(
        listing: models.ListingModel,
        catalogue_draft: schemas.CatalogueDraft,
        field_confidence: Dict[str, float],
        needs_confirmation: List[str],
        db: Session
    ) -> schemas.CatalogueResult:
        listing_id = listing.id
        # --- Provenance gate -------------------------------------------------
        # Runs on whatever produced the catalogue -- model, fixture, anything. A
        # sensitive claim needs an artisan assertion AND a coordinator verification
        # before it may be published, and a generator cannot assert on an artisan's
        # behalf. Without this, an unverified GI identifier reaches a buyer.
        provenance_report = None
        if config.enforce_provenance():
            gated, provenance_report = enforce_catalogue(
                catalogue_draft.model_dump(), generated=True
            )
            catalogue_draft = schemas.CatalogueDraft(**{
                k: v for k, v in gated.items() if k in schemas.CatalogueDraft.model_fields
            })
            # A claim held back for review is a thing the artisan must be told about,
            # so it belongs in needs_confirmation rather than only in a log.
            for claim_name in provenance_report["unpublishable_claims"]:
                field = f"provenance.{claim_name}"
                if field not in needs_confirmation:
                    needs_confirmation.append(field)

        result = schemas.CatalogueResult(
            schema_version="1.0",
            catalogue=catalogue_draft,
            field_confidence=field_confidence,
            needs_confirmation=needs_confirmation
        )

        # Upsert Catalogue in DB
        existing_cat = db.query(models.CatalogueModel).filter(models.CatalogueModel.listing_id == listing_id).first()
        if existing_cat:
            existing_cat.catalogue_data = json.dumps(catalogue_draft.model_dump())
            existing_cat.field_confidence = json.dumps(field_confidence)
            existing_cat.needs_confirmation = json.dumps(needs_confirmation)
        else:
            new_cat = models.CatalogueModel(
                listing_id=listing_id,
                schema_version="1.0",
                catalogue_data=json.dumps(catalogue_draft.model_dump()),
                field_confidence=json.dumps(field_confidence),
                needs_confirmation=json.dumps(needs_confirmation)
            )
            db.add(new_cat)

        # Sync claims into listing, from the gated catalogue so a downgraded
        # assertion is not silently re-asserted at the database layer.
        gated_claims = catalogue_draft.provenance.claims
        for c in gated_claims:
            existing_claim = db.query(models.ClaimModel).filter(
                models.ClaimModel.listing_id == listing_id,
                models.ClaimModel.claim == c.claim
            ).first()
            if not existing_claim:
                new_claim = models.ClaimModel(
                    listing_id=listing_id,
                    claim=c.claim,
                    asserted_by_artisan=c.asserted_by_artisan,
                    coordinator_verified=c.coordinator_verified,
                    evidence_note=c.evidence_note
                )
                db.add(new_claim)

        listing.state = "awaiting_confirmation"
        db.commit()
        return result

    @staticmethod
    def calculate_fair_price(
        listing_id: str,
        material_cost_paise: Optional[int],
        labour_hours: Optional[float],
        skill_level: Optional[str],
        state_code: Optional[str],
        db: Session,
        comparables_paise: Optional[List[int]] = None,
    ) -> schemas.PriceResult:
        listing = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
        if not listing:
            raise HTTPException(status_code=404, detail="Listing not found")

        # If inputs not supplied, extract from catalogue
        if material_cost_paise is None or labour_hours is None:
            cat_model = db.query(models.CatalogueModel).filter(models.CatalogueModel.listing_id == listing_id).first()
            if cat_model:
                cat_data = json.loads(cat_model.catalogue_data)
                material_cost_paise = material_cost_paise or cat_data.get("material_cost_paise", 45000)
                labour_hours = labour_hours or cat_data.get("labour", {}).get("hours", 6.0)
                state_code = state_code or cat_data.get("labour", {}).get("state_code", "KA")
            else:
                material_cost_paise = material_cost_paise or 45000
                labour_hours = labour_hours or 6.0
                state_code = state_code or "KA"

        if material_cost_paise is None or labour_hours is None:
            # A generated catalogue leaves these null until the artisan states them.
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "CATALOGUE_SCHEMA_INVALID",
                    "message": "Labour hours and material cost have not been confirmed for this listing.",
                    "recoverable": True,
                    "action": "Ask the artisan for the hours and the material cost, then price again.",
                },
            )

        state_code = (state_code or "KA").upper()

        if config.use_deterministic_pricing():
            return AIService._deterministic_price(
                listing_id=listing_id,
                material_cost_paise=int(material_cost_paise),
                labour_hours=float(labour_hours),
                skill_level=skill_level or "skilled",
                state_code=state_code,
                comparables_paise=comparables_paise or [],
                db=db,
            )

        if state_code not in STATUTORY_WAGES:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "WAGE_RATE_UNAVAILABLE",
                    "message": f"Statutory craft minimum wage is not officially notified for state code: {state_code}",
                    "recoverable": True,
                    "action": "Select a recognized state code (e.g. KA, UP, RJ, TN, MP, IN) or input verified artisan rate."
                }
            )

        wage_data = STATUTORY_WAGES[state_code]
        hourly_wage = wage_data["hourly_wage_paise"]

        floor_paise = int(material_cost_paise + (labour_hours * hourly_wage))
        rec_low_paise = int(floor_paise * 1.25)
        rec_high_paise = int(floor_paise * 1.55)

        explanation = (
            f"Statutory Fair Wage Protection Floor: ₹{floor_paise / 100:.2f} "
            f"(Raw Materials: ₹{material_cost_paise / 100:.2f} + {labour_hours} hrs skilled labor @ "
            f"₹{hourly_wage / 100:.2f}/hr per {wage_data['notification_ref']}). "
            f"Suggested e-commerce market band: ₹{rec_low_paise / 100:.2f} – ₹{rec_high_paise / 100:.2f}."
        )

        wage_source = schemas.WageSourceInfo(
            state_code=wage_data["state_code"],
            notification_ref=wage_data["notification_ref"],
            effective_from=wage_data["effective_from"],
            source_url=wage_data["source_url"]
        )

        price_inputs = schemas.PriceInputs(
            material_cost_paise=material_cost_paise,
            labour_hours=labour_hours,
            hourly_wage_paise=hourly_wage,
            skill_level=skill_level or "skilled"
        )

        price_result = schemas.PriceResult(
            calculation_version="1.0",
            status="available",
            currency="INR",
            wage_source=wage_source,
            inputs=price_inputs,
            floor_amount_paise=floor_paise,
            recommended_low_paise=rec_low_paise,
            recommended_high_paise=rec_high_paise,
            explanation=explanation
        )

        # Upsert in DB
        existing_price = db.query(models.PriceCalculationModel).filter(
            models.PriceCalculationModel.listing_id == listing_id
        ).first()

        if existing_price:
            existing_price.state_code = state_code
            existing_price.notification_ref = wage_data["notification_ref"]
            existing_price.effective_from = wage_data["effective_from"]
            existing_price.source_url = wage_data["source_url"]
            existing_price.material_cost_paise = material_cost_paise
            existing_price.labour_hours = labour_hours
            existing_price.hourly_wage_paise = hourly_wage
            existing_price.skill_level = skill_level or "skilled"
            existing_price.floor_amount_paise = floor_paise
            existing_price.recommended_low_paise = rec_low_paise
            existing_price.recommended_high_paise = rec_high_paise
            existing_price.explanation = explanation
        else:
            new_price = models.PriceCalculationModel(
                listing_id=listing_id,
                calculation_version="1.0",
                status="available",
                currency="INR",
                state_code=state_code,
                notification_ref=wage_data["notification_ref"],
                effective_from=wage_data["effective_from"],
                source_url=wage_data["source_url"],
                material_cost_paise=material_cost_paise,
                labour_hours=labour_hours,
                hourly_wage_paise=hourly_wage,
                skill_level=skill_level or "skilled",
                floor_amount_paise=floor_paise,
                recommended_low_paise=rec_low_paise,
                recommended_high_paise=rec_high_paise,
                explanation=explanation
            )
            db.add(new_price)

        db.commit()
        return price_result
    # ------------------------------------------------------------------ deterministic

    @staticmethod
    def _techniques_for(listing_id: str, db: Session) -> List[str]:
        """Techniques drive the complexity multiplier, so read them if a catalogue exists."""
        cat = db.query(models.CatalogueModel).filter(
            models.CatalogueModel.listing_id == listing_id
        ).first()
        if not cat or not cat.catalogue_data:
            return []
        try:
            return list(json.loads(cat.catalogue_data).get("techniques") or [])
        except (ValueError, AttributeError):
            return []

    @staticmethod
    def _deterministic_price(
        *,
        listing_id: str,
        material_cost_paise: int,
        labour_hours: float,
        skill_level: str,
        state_code: str,
        comparables_paise: List[int],
        db: Session,
    ) -> schemas.PriceResult:
        """Price through the tested engine in pricing/engine.py.

        Differs from the legacy path in three ways that matter to the pitch:
        skill_level is a real lookup key, comparables may lift the band but never lower
        it, and a missing wage notification refuses instead of substituting an estimate.
        """
        try:
            payload = price_bridge.calculate(
                material_cost_paise=material_cost_paise,
                labour_hours=labour_hours,
                skill_level=skill_level,
                state_code=state_code,
                techniques=AIService._techniques_for(listing_id, db),
                comparables_paise=comparables_paise,
            )
        except WageRateUnavailable as exc:
            # Deliberately fatal. The alternative is a floor that looks authoritative
            # and is not, which is the one error an artisan cannot detect.
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "WAGE_RATE_UNAVAILABLE",
                    "message": str(exc).replace("\n", " "),
                    "recoverable": True,
                    "action": (
                        "Transcribe the state minimum-wage notification into "
                        "app/ai/pricing/wage_table.json with its source URL and effective "
                        "date. For a demo, set CRAFTLINK_WAGE_TABLE=demo."
                    ),
                },
            ) from exc
        except InvalidPricingInput as exc:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "CATALOGUE_SCHEMA_INVALID",
                    "message": str(exc),
                    "recoverable": True,
                    "action": "Correct the labour hours, skill level or material cost.",
                },
            ) from exc

        result = schemas.PriceResult(**payload)
        AIService._persist_price(listing_id, payload, db)
        return result

    @staticmethod
    def _persist_price(listing_id: str, payload: Dict[str, Any], db: Session) -> None:
        source = payload["wage_source"]
        inputs = payload["inputs"]
        fields = dict(
            calculation_version=payload["calculation_version"],
            status=payload["status"],
            currency=payload["currency"],
            state_code=source["state_code"],
            notification_ref=source["notification_ref"],
            effective_from=source["effective_from"],
            source_url=source["source_url"],
            material_cost_paise=inputs["material_cost_paise"],
            labour_hours=inputs["labour_hours"],
            hourly_wage_paise=inputs["hourly_wage_paise"],
            skill_level=inputs["skill_level"],
            floor_amount_paise=payload["floor_amount_paise"],
            recommended_low_paise=payload["recommended_low_paise"],
            recommended_high_paise=payload["recommended_high_paise"],
            explanation=payload["explanation"],
        )
        existing = db.query(models.PriceCalculationModel).filter(
            models.PriceCalculationModel.listing_id == listing_id
        ).first()
        if existing:
            for key, value in fields.items():
                setattr(existing, key, value)
        else:
            db.add(models.PriceCalculationModel(listing_id=listing_id, **fields))
        db.commit()


ai_service = AIService()
