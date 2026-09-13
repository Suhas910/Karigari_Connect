# backend/app/main.py
import uuid
from fastapi import FastAPI, Request, HTTPException, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError

from .database import engine, Base
from .routers import auth as auth_router, listings, ai, coordinator, media, products, images

# Initialize Database Schema
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Karigari Connect API",
    description="AI-Driven Market Linkage and Smart Cataloging Mobile Backend for Marginalized Artisans (SIH 2026 PS 26090)",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

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

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    request_id = str(uuid.uuid4())
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "request_id": request_id,
            "error": {
                "code": "CATALOGUE_SCHEMA_INVALID",
                "message": str(exc),
                "recoverable": True,
                "action": "Correct the payload fields to match schema specification."
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
app.include_router(media.router, prefix="/api/v1")

# --- ROOT & BACKWARDS COMPATIBILITY ROUTERS ---
app.include_router(auth_router.router)
app.include_router(listings.router)
app.include_router(ai.router)
app.include_router(coordinator.router)
app.include_router(media.router)
app.include_router(products.router)
app.include_router(images.router)