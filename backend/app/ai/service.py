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
from .gemini_client import DEMO_NOTICE, gemini_client
from .provenance_gate import enforce_catalogue
from .pricing import bridge as price_bridge
from .pricing.engine import InvalidPricingInput, WageRateUnavailable
from .adapters import DEFAULT_ASR_PREFERENCE, GeminiCatalogueAdapter, GeminiPhotoCheck, resolve_asr
from .contracts import AIError, ErrorCode, PhotoCheckResult, QualityReport, TranscriptResult
from ..storage import MediaNotFound, StorageUnavailable, get_media_store

logger = logging.getLogger(__name__)

# Stamped on every result the legacy paths build from gemini_client's fixed content.
LEGACY_ADAPTER = {"provider": "fixture", "model": "legacy-demo", "version": None, "on_device": True}

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

        if config.image_mode() != "legacy":
            return AIService._studio_image_job(listing, media_id, db)

        # LEGACY. Grades a URL string it never opens; see vision/ and adapters/gemini_photo.py.
        # Find media asset
        media = db.query(models.MediaAssetModel).filter(
            models.MediaAssetModel.id == media_id,
            models.MediaAssetModel.listing_id == listing_id
        ).first()

        if not media:
            # Used to fall back to a stock photograph and grade that.
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "LISTING_STATE_INVALID",
                    "message": "This listing has no photo with that id.",
                    "recoverable": True,
                    "action": "Upload the photo first.",
                },
            )
        original_url = media.url
        
        # Fixed demo grades: the photo is not opened.
        audit = gemini_client.audit_image_quality(original_url)

        # Nothing was analysed and no enhanced photo exists, so none is claimed. This path
        # used to list four transformations that never ran and return a stock photo URL
        # with query parameters appended as the "enhanced" image.
        result_payload = {
            "job_id": "",
            "status": "complete",
            "quality": audit,
            "original_url": original_url,
            "enhanced_media_id": None,
            "enhanced_url": None,
            "enhanced_urls": [],
            "transformations": [],
            "human_review_required": True,
            "adapter": LEGACY_ADAPTER,
            "notice": DEMO_NOTICE,
        }

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
    def _photo_check(data: bytes, mime_type: str) -> tuple[Dict[str, Any], Optional[PhotoCheckResult]]:
        """The optional Gemini second opinion. Returns (summary for the response, result)."""
        if config.photo_check_mode() == "off":
            return {"status": "skipped"}, None
        try:
            result = GeminiPhotoCheck().check(data, mime_type)
        except AIError as exc:
            # The measured grade stands on its own. A missing second opinion is reported,
            # not treated as a failed photo.
            logger.warning("Photo check unavailable: %s", exc.message)
            return {"status": "unavailable", "code": exc.code.value, "message": exc.message}, None
        return {"status": "complete", "issues": result.issues, "adapter": result.adapter.model_dump()}, result

    @staticmethod
    def _stricter(report: QualityReport, check: PhotoCheckResult) -> QualityReport:
        """Apply the photo check. It can lower the overall grade and add guidance, never raise it."""
        order = ["acceptable", "needs_correction", "unacceptable"]
        overall = max(report.overall, check.level, key=order.index)
        guidance = [*report.guidance, *[g for g in check.guidance if g not in report.guidance]]
        return report.model_copy(update={"overall": overall, "guidance": guidance})

    @staticmethod
    def _studio_image_job(
        listing: models.ListingModel,
        media_id: str,
        db: Session
    ) -> models.JobModel:
        """Grade and enhance the uploaded photo.

        An unusable photo is a failed job carrying MEDIA_QUALITY_INSUFFICIENT and the
        quality report, so the app can show the retake guidance. A usable one produces an
        enhanced JPEG stored as its own media asset; the original is never replaced.
        """
        image_mode, check_mode = config.image_mode(), config.photo_check_mode()
        if image_mode != "studio" or check_mode not in ("off", "gemini"):
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "PROVIDER_UNAVAILABLE",
                    "message": (
                        f"Unknown CRAFTLINK_IMAGE={image_mode!r} or CRAFTLINK_PHOTO_CHECK={check_mode!r}; "
                        "expected legacy or studio, and off or gemini."
                    ),
                    "recoverable": False,
                    "action": None,
                },
            )

        media = db.query(models.MediaAssetModel).filter(
            models.MediaAssetModel.id == media_id,
            models.MediaAssetModel.listing_id == listing.id
        ).first()
        if not media or media.kind != "image" or media.variant != "original" or not media.storage_path:
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "LISTING_STATE_INVALID",
                    "message": "This listing has no uploaded photo with that id.",
                    "recoverable": True,
                    "action": "Upload the photo with POST /listings/{listing_id}/media/upload and use the media_id it returns.",
                },
            )

        import cv2
        import numpy as np

        from .. import media_inspect
        from ..storage import get_media_store as active_store
        from .vision import segmentation
        from .vision.quality import assess
        from .vision.studio import enhance

        job = models.JobModel(
            job_id=str(uuid.uuid4()),
            listing_id=listing.id,
            type="image_studio",
            status="processing",
            attempt=1,
        )
        result: Dict[str, Any] = {
            "job_id": job.job_id,
            "original_media_id": media.id,
            "original_url": media.url,
        }
        error: Optional[AIError] = None
        stored = None  # (store, key) of the enhanced file, for cleanup if the row fails

        try:
            metadata = json.loads(media.metadata_json or "{}")
            data = get_media_store(metadata.get("storage_backend")).get(media.storage_path)
            image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if image is None:
                raise AIError(
                    ErrorCode.MEDIA_QUALITY_INSUFFICIENT,
                    "This photo could not be read. Take it again.",
                    recoverable=True,
                    action="retake_photo",
                )

            report = assess(image)
            result["photo_check"], check = AIService._photo_check(data, metadata.get("content_type", "image/jpeg"))
            if check is not None:
                report = AIService._stricter(report, check)
            result["quality"] = report.model_dump()

            enhanced = enhance(image, quality=report)  # raises MEDIA_QUALITY_INSUFFICIENT when unusable
            ok, encoded = cv2.imencode(".jpg", enhanced.image, [cv2.IMWRITE_JPEG_QUALITY, 90])
            if not ok:
                raise AIError(ErrorCode.PROVIDER_UNAVAILABLE, "The enhanced photo could not be encoded.", recoverable=True, action="retry_later")
            jpeg = encoded.tobytes()

            enhanced_id = str(uuid.uuid4())
            key = f"listings/{listing.id}/image/{enhanced_id}.jpg"
            store = active_store()
            store.put(key, jpeg, "image/jpeg")
            stored = (store, key)
            url = f"/api/v1/media/{enhanced_id}/content"
            sha = media_inspect.sha256_hex(jpeg)
            db.add(models.MediaAssetModel(
                id=enhanced_id,
                listing_id=listing.id,
                kind="image",
                variant="enhanced",
                status="complete",
                url=url,
                storage_path=key,
                checksum=f"sha256:{sha}",
                metadata_json=json.dumps({
                    "content_type": "image/jpeg",
                    "size_bytes": len(jpeg),
                    "stored_sha256": sha,
                    "storage_backend": store.name,
                    "source_media_id": media.id,
                    "transformations": enhanced.transformations,
                }),
            ))
            result.update({
                "enhanced_media_id": enhanced_id,
                "enhanced_url": url,
                "enhanced_urls": [url],
                "transformations": enhanced.transformations,
                "human_review_required": enhanced.human_review_required,
                "adapter": {
                    "provider": "studio",
                    "model": f"rembg-{segmentation.model_name()}",
                    "version": None,
                    "on_device": True,
                },
            })
        except MediaNotFound:
            logger.error("Image job: media %s points at missing object %s", media.id, media.storage_path)
            error = AIError(ErrorCode.LISTING_STATE_INVALID, "The photo is missing from storage.", recoverable=True, action="retake_photo")
        except StorageUnavailable as exc:
            logger.error("Image job: media store unavailable for %s: %s", media.id, exc)
            error = AIError(ErrorCode.PROVIDER_UNAVAILABLE, "The photo could not be read or saved.", recoverable=True, action="retry_later")
        except AIError as exc:
            error = exc

        if error is None:
            job.status = "complete"
            result["status"] = "complete"
            listing.state = "processing"
        else:
            job.status = "failed"
            result["status"] = "failed"
            job.error_data = json.dumps(error.as_dict())
        job.result_data = json.dumps(result)

        db.add(job)
        try:
            db.commit()
        except Exception:
            db.rollback()
            if stored:
                try:
                    stored[0].delete(stored[1])
                except Exception as cleanup_exc:  # noqa: BLE001
                    logger.error("Orphaned enhanced photo %s: %s", stored[1], cleanup_exc)
            raise
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

        if not audio_media:
            # Used to fall back to "sample_audio.wav" and return a transcript of nothing.
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "LISTING_STATE_INVALID",
                    "message": "This listing has no voice recording with that id.",
                    "recoverable": True,
                    "action": "Upload the recording first.",
                },
            )
        transcription_res = {
            **gemini_client.transcribe_and_translate(audio_media.url, declared_language=declared_language),
            "adapter": LEGACY_ADAPTER,
            "notice": DEMO_NOTICE,
        }

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
            if not (result.original_text or "").strip():
                # A silent recording used to finish as "complete" with empty text, so the app
                # showed nothing and product details were generated from no words at all.
                raise AIError(
                    ErrorCode.ASR_LOW_CONFIDENCE,
                    "No speech was heard in this recording.",
                    recoverable=True,
                    action="record_again",
                )
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
        asr_provider = None
        transcript_id = str(uuid.uuid4())

        if trans_job and trans_job.result_data:
            data = json.loads(trans_job.result_data)
            asr_provider = (data.get("adapter") or {}).get("provider", "fixture")
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
                asr_confidence=asr_conf,
                asr_provider=asr_provider,
                catalogue_provider="fixture",
            )
        )

        return AIService._gate_and_store(
            listing, catalogue_draft, field_confidence, needs_confirmation, db, adapter=LEGACY_ADAPTER
        )

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
                    "action": "Transcribe the uploaded recording first (CRAFTLINK_ASR=local or gemini), then generate again.",
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
                asr_provider=cat["source"].get("asr_provider"),
                catalogue_provider=result.adapter.provider,
            ),
        )
        return AIService._gate_and_store(
            listing,
            catalogue_draft,
            dict(result.field_confidence),
            list(result.needs_confirmation),
            db,
            adapter=result.adapter.model_dump(),
        )

    @staticmethod
    def _gate_and_store(
        listing: models.ListingModel,
        catalogue_draft: schemas.CatalogueDraft,
        field_confidence: Dict[str, float],
        needs_confirmation: List[str],
        db: Session,
        adapter: Optional[Dict[str, Any]] = None,
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
            needs_confirmation=needs_confirmation,
            adapter=adapter,
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

        # Inputs not in the request come from the confirmed catalogue, never from defaults.
        # A floor computed from a made-up hour count looks official and is not.
        if None in (material_cost_paise, labour_hours, skill_level, state_code):
            cat_model = db.query(models.CatalogueModel).filter(models.CatalogueModel.listing_id == listing_id).first()
            cat_data = json.loads(cat_model.catalogue_data) if cat_model else {}
            labour = cat_data.get("labour") or {}
            if material_cost_paise is None:
                material_cost_paise = cat_data.get("material_cost_paise")
            if labour_hours is None:
                labour_hours = labour.get("hours")
            if skill_level is None:
                skill_level = labour.get("skill_level")
            if state_code is None:
                state_code = labour.get("state_code")

        missing = [
            name for name, value in (
                ("material cost", material_cost_paise),
                ("labour hours", labour_hours),
                ("skill level", skill_level),
                ("state", state_code),
            )
            if value is None
        ]
        if missing:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "CATALOGUE_SCHEMA_INVALID",
                    "message": "Not yet confirmed for this listing: " + ", ".join(missing) + ".",
                    "recoverable": True,
                    "action": "Ask the artisan to confirm these details, then price again.",
                },
            )

        state_code = str(state_code).upper()

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
