import os
import uuid
import logging
from fastapi import FastAPI, Request, HTTPException, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger(__name__)

from .database import init_db
from .ai.service import MEDIA_ROOT
from .routers import auth as auth_router, listings, ai, coordinator, price_router, profile, support
from .validation_handler import register_validation_handler

# Initialize Database Schema & Seed Demo Accounts (resilient on both primary and fallback)
init_db()

app = FastAPI(
    title="Karigari Connect API",
    description="AI-Driven Market Linkage and Smart Cataloging Mobile Backend for Marginalized Artisans (SIH 2026 PS 26090)",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

register_validation_handler(app)

# Safe CORS Middleware: Explicit origin allowlist with regex fallback for mobile/dev
raw_origins = os.getenv("ALLOWED_ORIGINS", "")
allowed_origins = [o.strip() for o in raw_origins.split(",") if o.strip()]
if not allowed_origins:
    allowed_origins = [
        "http://localhost:3000",
        "http://localhost:8081",
        "http://localhost:19006",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8081",
        "http://127.0.0.1:19006",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Standardized Error Response Handler matching contracts.ts ---
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    request_id = str(uuid.uuid4())
    detail = exc.detail
    code = "PROVIDER_UNAVAILABLE"
    message = str(detail)
    recoverable = True
    action = "Retry the operation or contact support."

    if isinstance(detail, dict):
        if "error" in detail and isinstance(detail["error"], dict):
            code = detail["error"].get("code", "LISTING_STATE_INVALID")
            message = detail["error"].get("message", str(detail))
            recoverable = detail["error"].get("recoverable", True)
            action = detail["error"].get("action", "")
            if "request_id" in detail:
                request_id = detail["request_id"]
        else:
            code = detail.get("code", "LISTING_STATE_INVALID")
            message = detail.get("message", str(detail))
            recoverable = detail.get("recoverable", True)
            action = detail.get("action", "")
    elif exc.status_code == 400:
        code = "INVALID_INPUT"
        message = str(detail)
        action = "Check request parameters and try again."
    elif exc.status_code == 401:
        code = "PROVIDER_UNAVAILABLE"
        message = str(detail)
        action = "Please log in again."
    elif exc.status_code == 403:
        code = "PROVENANCE_VERIFICATION_REQUIRED"
        message = str(detail)
        action = "Coordinator credentials required."
    elif exc.status_code == 404:
        code = "LISTING_STATE_INVALID"
        message = str(detail)
        action = "Check the requested resource identifier."
    elif exc.status_code == 422:
        code = "INVALID_INPUT"

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "request_id": request_id,
            "error": {
                "code": code,
                "message": message,
                "recoverable": recoverable,
                "action": action
            }
        }
    )

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception processing %s %s: %s", request.method, request.url, exc, exc_info=True)
    request_id = str(uuid.uuid4())
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "request_id": request_id,
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected internal error occurred. Please retry shortly or contact support.",
                "recoverable": True,
                "action": "Please retry shortly or contact support."
            }
        }
    )

# --- HEALTH CHECK ENDPOINTS ---
@app.get("/")
async def root():
    return {
        "service": "Karigari Connect Backend API",
        "status": "online",
        "version": "1.0.0",
        "sih_ps": "26090",
        "theme": "Heritage & Culture",
        "docs": "/docs"
    }

@app.get("/health")
@app.get("/api/v1/health")
async def health_check():
    return {"status": "ok", "service": "karigari-connect-backend"}

# --- V1 ROUTER REGISTRATION ---
app.include_router(auth_router.router, prefix="/api/v1")
app.include_router(listings.router, prefix="/api/v1")
app.include_router(ai.router, prefix="/api/v1")
app.include_router(coordinator.router, prefix="/api/v1")
app.include_router(price_router.router, prefix="/api/v1")
app.include_router(profile.router, prefix="/api/v1")
app.include_router(support.router, prefix="/api/v1")

# --- ROOT & BACKWARDS COMPATIBILITY ROUTERS ---
# Note: Unprefixed root routes are legacy compatibility mirrors slated for deprecation.
# All new clients and integrations should target the canonical /api/v1 endpoints.
app.include_router(auth_router.router, include_in_schema=False)
app.include_router(listings.router, include_in_schema=False)
app.include_router(ai.router, include_in_schema=False)
app.include_router(coordinator.router, include_in_schema=False)
app.include_router(price_router.router, include_in_schema=False)
app.include_router(profile.router, include_in_schema=False)
app.include_router(support.router, include_in_schema=False)

# Uploaded and BiRefNet-enhanced listing photos
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=MEDIA_ROOT), name="media")