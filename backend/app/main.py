# backend/app/main.py
import uuid
import logging
from fastapi import FastAPI, Request, HTTPException, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger(__name__)

from .database import engine, Base, init_db
from .ai.service import MEDIA_ROOT
from .routers import auth as auth_router, listings, ai, coordinator, products, images, price_router, profile, support
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

# CORS Middleware for React Native / Web Clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
        code = "CATALOGUE_SCHEMA_INVALID"

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
                "message": str(exc),
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
app.include_router(auth_router.router)
app.include_router(listings.router)
app.include_router(ai.router)
app.include_router(coordinator.router)
app.include_router(price_router.router)
app.include_router(profile.router)
app.include_router(support.router)
app.include_router(products.router)
app.include_router(images.router)

# Uploaded and BiRefNet-enhanced listing photos
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=MEDIA_ROOT), name="media")