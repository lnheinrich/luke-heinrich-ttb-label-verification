import json
import logging
import os
import time
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from dotenv import load_dotenv

from app.comparison import verify_label
from app.models import ApplicationData, VerificationResult
from app.vision import VisionInputError, VisionProviderError, VisionService


load_dotenv()


APP_NAME = "ttb-label-verification"
MAX_IMAGE_BYTES = 10 * 1024 * 1024
SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
logger = logging.getLogger(__name__)

# Local frontend origins used when CORS_ORIGINS is not configured.
DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app = FastAPI(title="TTB Label Verification")

# Comma-separated origins allow local and deployed frontends to coexist.
cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
] or DEFAULT_CORS_ORIGINS

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    if request.url.path == "/verify":
        return JSONResponse(
            status_code=422,
            content={"detail": "Request must include image and application_data."},
        )

    return JSONResponse(status_code=422, content={"detail": exc.errors()})


def get_vision_service() -> VisionService:
    return VisionService()


# Lightweight deploy and uptime check endpoint.
@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": APP_NAME}


# Verify one uploaded label image against one set of application values.
@app.post("/verify", response_model=VerificationResult)
async def verify(
    image: Annotated[UploadFile, File()],
    application_data: Annotated[str, Form()],
    vision_service: Annotated[VisionService, Depends(get_vision_service)],
) -> VerificationResult:
    start_time = time.perf_counter()
    content_type = image.content_type or ""

    try:
        if content_type not in SUPPORTED_IMAGE_TYPES:
            raise HTTPException(
                status_code=400,
                detail="Unsupported image type. Use JPEG, PNG, or WebP.",
            )

        image_bytes = await image.read()
        image_size = len(image_bytes)
        if image_size == 0:
            raise HTTPException(status_code=400, detail="Image file is empty.")
        if image_size > MAX_IMAGE_BYTES:
            raise HTTPException(
                status_code=413,
                detail="Image is too large. Maximum size is 10 MB.",
            )

        application = parse_application_data(application_data)
        extracted = vision_service.extract_label(image_bytes, content_type)
        latency_ms = elapsed_ms(start_time)
        result = verify_label(application, extracted, latency_ms=latency_ms)
        log_verify_request(
            latency_ms=latency_ms,
            content_type=content_type,
            image_size=image_size,
            status="success",
            overall_verdict=result.overall_verdict,
        )

        return result
    except HTTPException as exc:
        log_verify_request(
            latency_ms=elapsed_ms(start_time),
            content_type=content_type,
            image_size=None,
            status=f"error_{exc.status_code}",
            overall_verdict=None,
        )
        raise
    except VisionInputError as exc:
        log_verify_request(
            latency_ms=elapsed_ms(start_time),
            content_type=content_type,
            image_size=None,
            status="error_422",
            overall_verdict=None,
        )
        raise HTTPException(
            status_code=422,
            detail="Could not read the label image. Try a clearer photo.",
        ) from exc
    except VisionProviderError as exc:
        log_verify_request(
            latency_ms=elapsed_ms(start_time),
            content_type=content_type,
            image_size=None,
            status="error_502",
            overall_verdict=None,
        )
        raise HTTPException(
            status_code=502,
            detail="Label extraction is temporarily unavailable. Try again.",
        ) from exc


# Parse and validate the application JSON form field.
def parse_application_data(application_data: str) -> ApplicationData:
    if not application_data.strip():
        raise HTTPException(
            status_code=422,
            detail="Application data must be valid JSON with all required fields.",
        )

    try:
        parsed = json.loads(application_data)
        if not isinstance(parsed, dict):
            raise ValueError("application_data must be an object")
        return ApplicationData.model_validate(parsed)
    except (json.JSONDecodeError, ValidationError, ValueError) as exc:
        raise HTTPException(
            status_code=422,
            detail="Application data must be valid JSON with all required fields.",
        ) from exc


# Convert elapsed request time to integer milliseconds.
def elapsed_ms(start_time: float) -> int:
    return int((time.perf_counter() - start_time) * 1000)


# Log request metadata without label text, image bytes, or provider payloads.
def log_verify_request(
    *,
    latency_ms: int,
    content_type: str,
    image_size: int | None,
    status: str,
    overall_verdict: str | None,
) -> None:
    logger.info(
        "verify_request latency_ms=%s status=%s overall_verdict=%s content_type=%s image_size=%s",
        latency_ms,
        status,
        overall_verdict,
        content_type or "unknown",
        image_size if image_size is not None else "unknown",
    )
