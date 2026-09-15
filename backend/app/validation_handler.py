import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def register_validation_handler(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        request_id = f"req_{uuid.uuid4().hex[:12]}"
        # take first error, keep message short — don't dump raw pydantic internals to artisan-facing app
        first = exc.errors()[0] if exc.errors() else {}
        field = ".".join(str(loc) for loc in first.get("loc", []) if loc != "body")
        return JSONResponse(
            status_code=422,
            content={
                "request_id": request_id,
                "error": {
                    "code": "INVALID_INPUT",
                    "message": f"Invalid value for '{field}': {first.get('msg', 'validation failed')}",
                    "recoverable": True,
                    "action": "correct_input",
                },
            },
        )


# usage in main.py:
#   from app.validation_handler import register_validation_handler
#   app = FastAPI()
#   register_validation_handler(app)
#   app.include_router(price_router, prefix="/api/v1")