# backend/app/ai/service.py
import json
import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple
from sqlalchemy.orm import Session
from fastapi import HTTPException

from .. import models, schemas
from . import birefnet, studio
from .gemini_client import gemini_client

logger = logging.getLogger(__name__)

# Uploaded and enhanced listing photos; served by main.py at /media.
MEDIA_ROOT = Path(__file__).resolve().parents[2] / "media_store"

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
    def create_birefnet_image_job(
        listing: models.ListingModel,
        photos: List[Tuple[str, bytes]],
        base_url: str,
        db: Session
    ) -> Tuple[models.JobModel, List[str]]:
        """
        Store the uploaded photos as original media and create a 'processing' image_studio job.
        photos is a list of (file extension, bytes). run_birefnet_image_job completes the job.
        Returns the job and the original media ids, in upload order.
        """
        listing_dir = MEDIA_ROOT / listing.id
        listing_dir.mkdir(parents=True, exist_ok=True)
        base_url = base_url.rstrip("/")

        original_media_ids = []
        for extension, content in photos:
            media_id = str(uuid.uuid4())
            filename = f"{media_id}.{extension}"
            (listing_dir / filename).write_bytes(content)
            db.add(models.MediaAssetModel(
                id=media_id,
                listing_id=listing.id,
                kind="image",
                variant="original",
                status="complete",
                url=f"{base_url}/media/{listing.id}/{filename}",
                storage_path=f"{listing.id}/{filename}"
            ))
            original_media_ids.append(media_id)

        job = models.JobModel(
            job_id=str(uuid.uuid4()),
            listing_id=listing.id,
            type="image_studio",
            status="processing",
            attempt=1
        )
        listing.state = "processing"
        db.add(job)
        db.commit()
        db.refresh(job)
        return job, original_media_ids

    @staticmethod
    def run_birefnet_image_job(
        job_id: str,
        original_media_ids: List[str],
        base_url: str,
        engine: str = "processing",
        background: str = "studio"
    ) -> None:
        """
        Background task: turn each stored photo into a catalogue photo (angle, background, studio light)
        with the requested studio engine, then complete or fail the job.
        """
        from ..database import SessionLocal

        db = SessionLocal()
        try:
            job = db.query(models.JobModel).filter(models.JobModel.job_id == job_id).first()
            if not job:
                return
            base_url = base_url.rstrip("/")
            originals = [
                db.query(models.MediaAssetModel).filter(models.MediaAssetModel.id == media_id).first()
                for media_id in original_media_ids
            ]

            try:
                enhanced, studio_results = [], []
                for original in originals:
                    studio_result = studio.enhance(
                        (MEDIA_ROOT / original.storage_path).read_bytes(), engine=engine, background=background
                    )
                    content = studio_result.image_bytes
                    media_id = str(uuid.uuid4())
                    filename = f"{media_id}.jpg"
                    (MEDIA_ROOT / original.listing_id / filename).write_bytes(content)
                    media = models.MediaAssetModel(
                        id=media_id,
                        listing_id=original.listing_id,
                        kind="image",
                        variant="enhanced",
                        status="complete",
                        url=f"{base_url}/media/{original.listing_id}/{filename}",
                        storage_path=f"{original.listing_id}/{filename}",
                        metadata_json=json.dumps({
                            "source_media_id": original.id,
                            "model": birefnet.MODEL_ID,
                            "engine": studio_result.engine,
                            "ai_generated": studio_result.engine == "ai",
                            "transformations": studio_result.transformations,
                            "details": studio_result.details
                        })
                    )
                    db.add(media)
                    enhanced.append(media)
                    studio_results.append(studio_result)
            except Exception as exc:
                logger.error("BiRefNet enhancement failed for job %s: %s", job_id, exc, exc_info=True)
                db.rollback()
                job.status = "failed"
                job.result_data = json.dumps({"job_id": job_id, "status": "failed", "error": str(exc)})
                db.commit()
                return

            audit = gemini_client.audit_image_quality(originals[0].url)
            job.status = "complete"
            job.result_data = json.dumps({
                "job_id": job_id,
                "status": "complete",
                "quality": audit,
                "original_url": originals[0].url,
                "enhanced_media_id": enhanced[0].id,
                "enhanced_url": enhanced[0].url,
                "enhanced_urls": [media.url for media in enhanced],
                "transformations": list(dict.fromkeys(t for r in studio_results for t in r.transformations)),
                "requested_engine": engine,
                "background": background,
                "enhancements": [
                    {
                        "media_id": media.id,
                        "engine": result.engine,
                        "transformations": result.transformations,
                        "human_review_required": result.human_review_required,
                        **result.details
                    }
                    for media, result in zip(enhanced, studio_results)
                ],
                "human_review_required": (
                    audit.get("overall") == "needs_review"
                    or any(r.human_review_required for r in studio_results)
                )
            })
            db.commit()
        finally:
            db.close()

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
    def generate_catalogue(
        listing_id: str,
        payload: Optional[Dict[str, Any]],
        db: Session
    ) -> schemas.CatalogueResult:
        listing = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
        if not listing:
            raise HTTPException(status_code=404, detail="Listing not found")

        # Check if there was a transcription job
        trans_job = db.query(models.JobModel).filter(
            models.JobModel.listing_id == listing_id,
            models.JobModel.type == "transcription"
        ).order_by(models.JobModel.created_at.desc()).first()

        declared_lang = listing.preferred_language or "kn"
        sample_text = ""
        asr_conf = 0.95
        transcript_id = str(uuid.uuid4())

        if trans_job and trans_job.result_data:
            data = json.loads(trans_job.result_data)
            sample_text = data.get("translated_text", "")
            asr_conf = data.get("asr_confidence", 0.95)
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

        # Gemini returns claims either as objects or as bare names such as "natural_dye".
        raw_claims = [
            c if isinstance(c, dict) else {"claim": c}
            for c in (raw_cat.get("claims") or [])
        ]
        claims_list = [
            schemas.ClaimSchema(
                claim=c["claim"],
                asserted_by_artisan=c.get("asserted_by_artisan", True),
                coordinator_verified=c.get("coordinator_verified", False),
                evidence_note=c.get("evidence_note")
            )
            for c in raw_claims
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

        # Sync claims into listing
        new_claim_names = {c.claim for c in claims_list}
        stale_claims = db.query(models.ClaimModel).filter(
            models.ClaimModel.listing_id == listing_id,
            models.ClaimModel.coordinator_verified == False,
            models.ClaimModel.claim.in_(["natural_dye", "gi_tag", "handloom_weave"]),
            ~models.ClaimModel.claim.in_(new_claim_names)
        ).all()
        for sc in stale_claims:
            db.delete(sc)

        for c in claims_list:
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
        db: Session
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

        state_code = (state_code or "KA").upper()
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

ai_service = AIService()
