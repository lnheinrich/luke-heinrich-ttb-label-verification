import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from dotenv import load_dotenv

from app.comparison import verify_label
from app.models import (
    ApplicationData,
    BatchItemResult,
    BatchResult,
    BatchSummary,
    VerificationResult,
)
from app.vision import VisionInputError, VisionProviderError, VisionService


load_dotenv()


APP_NAME = "ttb-label-verification"
MAX_IMAGE_BYTES = 10 * 1024 * 1024
BATCH_CONCURRENCY = 3
SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
logger = logging.getLogger(__name__)

# Local frontend origins used when CORS_ORIGINS is not configured.
DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


@dataclass(frozen=True)
class LabelVerificationMetrics:
    read_image_ms: int
    compare_ms: int
    original_image_size: int
    vision_metrics: object | None


@dataclass(frozen=True)
class LabelVerificationOutput:
    result: VerificationResult
    metrics: LabelVerificationMetrics

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
    if request.url.path in {"/verify", "/verify/batch"}:
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
        application = parse_application_data(application_data)
        output = await verify_uploaded_label(
            image=image,
            application=application,
            vision_service=vision_service,
            extract_semaphore=None,
        )
        result = output.result
        log_verify_request(
            latency_ms=result.latency_ms,
            content_type=content_type,
            metrics=output.metrics,
            status="success",
            overall_verdict=result.overall_verdict,
        )

        return result
    except HTTPException as exc:
        log_verify_request(
            latency_ms=elapsed_ms(start_time),
            content_type=content_type,
            metrics=None,
            status=f"error_{exc.status_code}",
            overall_verdict=None,
        )
        raise
    except VisionInputError as exc:
        log_verify_request(
            latency_ms=elapsed_ms(start_time),
            content_type=content_type,
            metrics=None,
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
            metrics=None,
            status="error_502",
            overall_verdict=None,
        )
        raise HTTPException(
            status_code=502,
            detail="Label extraction is temporarily unavailable. Try again.",
        ) from exc


# Verify multiple uploaded label image/application pairs in one request.
@app.post("/verify/batch", response_model=BatchResult)
async def verify_batch(
    images: Annotated[list[UploadFile], File()],
    application_data: Annotated[str, Form()],
    vision_service: Annotated[VisionService, Depends(get_vision_service)],
) -> BatchResult:
    start_time = time.perf_counter()
    parsed_items = parse_batch_application_data(application_data)
    validate_batch_shape(images, parsed_items)

    semaphore = asyncio.Semaphore(BATCH_CONCURRENCY)
    tasks = [
        verify_batch_item(
            index=index,
            image=image,
            application_payload=parsed_items[index],
            vision_service=vision_service,
            extract_semaphore=semaphore,
        )
        for index, image in enumerate(images)
    ]
    items = await asyncio.gather(*tasks)
    summary = build_batch_summary(items)
    latency_ms = elapsed_ms(start_time)
    logger.info(
        "verify_batch latency_ms=%s total=%s passed=%s needs_review=%s failed=%s",
        latency_ms,
        summary.total,
        summary.passed,
        summary.needs_review,
        summary.failed,
    )

    return BatchResult(items=items, summary=summary, latency_ms=latency_ms)


# Verify one uploaded image after request parsing has succeeded.
async def verify_uploaded_label(
    *,
    image: UploadFile,
    application: ApplicationData,
    vision_service: VisionService,
    extract_semaphore: asyncio.Semaphore | None,
) -> LabelVerificationOutput:
    start_time = time.perf_counter()
    content_type = image.content_type or ""
    read_start = time.perf_counter()
    image_bytes = await read_image_bytes(image)
    read_image_ms = elapsed_ms(read_start)

    extracted = await extract_label_async(
        vision_service=vision_service,
        image_bytes=image_bytes,
        content_type=content_type,
        extract_semaphore=extract_semaphore,
    )

    compare_start = time.perf_counter()
    result = verify_label(
        application,
        extracted,
        latency_ms=elapsed_ms(start_time),
    )
    compare_ms = elapsed_ms(compare_start)

    return LabelVerificationOutput(
        result=result,
        metrics=LabelVerificationMetrics(
            read_image_ms=read_image_ms,
            compare_ms=compare_ms,
            original_image_size=len(image_bytes),
            vision_metrics=getattr(vision_service, "last_metrics", None),
        ),
    )


# Run extraction through async test fakes or a worker thread for the real sync service.
async def extract_label_async(
    *,
    vision_service: VisionService,
    image_bytes: bytes,
    content_type: str,
    extract_semaphore: asyncio.Semaphore | None,
):
    async def run_extraction():
        async_extract = getattr(vision_service, "extract_label_async", None)
        if async_extract is not None:
            return await async_extract(image_bytes, content_type)

        return await asyncio.to_thread(
            vision_service.extract_label,
            image_bytes,
            content_type,
        )

    if extract_semaphore is None:
        return await run_extraction()

    async with extract_semaphore:
        return await run_extraction()


# Turn one batch item into either a completed result or item-level failure.
async def verify_batch_item(
    *,
    index: int,
    image: UploadFile,
    application_payload: object,
    vision_service: VisionService,
    extract_semaphore: asyncio.Semaphore,
) -> BatchItemResult:
    filename = image.filename or f"Label {index + 1}"

    try:
        application = parse_application_data_object(application_payload)
        output = await verify_uploaded_label(
            image=image,
            application=application,
            vision_service=vision_service,
            extract_semaphore=extract_semaphore,
        )
        return BatchItemResult(
            index=index,
            filename=filename,
            status="COMPLETED",
            verification=output.result,
        )
    except HTTPException as exc:
        return build_failed_batch_item(index, filename, str(exc.detail))
    except (ValidationError, ValueError):
        return build_failed_batch_item(
            index,
            filename,
            "Application data must include all required fields.",
        )
    except VisionInputError:
        return build_failed_batch_item(
            index,
            filename,
            "Could not read the label image. Try a clearer photo.",
        )
    except VisionProviderError:
        return build_failed_batch_item(
            index,
            filename,
            "Label extraction is temporarily unavailable. Try again.",
        )


# Read and validate image bytes shared by single and batch verification.
async def read_image_bytes(image: UploadFile) -> bytes:
    content_type = image.content_type or ""
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

    return image_bytes


# Parse and validate the application JSON form field.
def parse_application_data(application_data: str) -> ApplicationData:
    if not application_data.strip():
        raise HTTPException(
            status_code=422,
            detail="Application data must be valid JSON with all required fields.",
        )

    try:
        parsed = json.loads(application_data)
        return parse_application_data_object(parsed)
    except (json.JSONDecodeError, ValidationError, ValueError) as exc:
        raise HTTPException(
            status_code=422,
            detail="Application data must be valid JSON with all required fields.",
        ) from exc


# Validate one already-decoded application data object.
def parse_application_data_object(application_data: object) -> ApplicationData:
    if not isinstance(application_data, dict):
        raise ValueError("application_data must be an object")

    return ApplicationData.model_validate(application_data)


# Parse batch application data as an array; shape mismatches fail the whole request.
def parse_batch_application_data(application_data: str) -> list[object]:
    if not application_data.strip():
        raise HTTPException(
            status_code=422,
            detail="Batch application data must be a JSON array.",
        )

    try:
        parsed = json.loads(application_data)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=422,
            detail="Batch application data must be a JSON array.",
        ) from exc

    if not isinstance(parsed, list):
        raise HTTPException(
            status_code=422,
            detail="Batch application data must be a JSON array.",
        )

    return parsed


# Validate request-level batch shape before launching item work.
def validate_batch_shape(images: list[UploadFile], parsed_items: list[object]) -> None:
    if not images or not parsed_items:
        raise HTTPException(
            status_code=422,
            detail="Batch request must include at least one image and application data pair.",
        )
    if len(images) != len(parsed_items):
        raise HTTPException(
            status_code=422,
            detail="Batch request must include one application data object for each image.",
        )

# Build a failed item while preserving batch order and filename.
def build_failed_batch_item(index: int, filename: str, error: str) -> BatchItemResult:
    return BatchItemResult(
        index=index,
        filename=filename,
        status="FAILED",
        error=error,
    )


# Count completed verdicts and item-level failures for the batch summary.
def build_batch_summary(items: list[BatchItemResult]) -> BatchSummary:
    passed = sum(
        1
        for item in items
        if item.verification is not None
        and item.verification.overall_verdict == "APPROVED"
    )
    needs_review = sum(
        1
        for item in items
        if item.verification is not None
        and item.verification.overall_verdict == "NEEDS_REVIEW"
    )
    failed = sum(1 for item in items if item.status == "FAILED")

    return BatchSummary(
        passed=passed,
        needs_review=needs_review,
        failed=failed,
        total=len(items),
    )


# Convert elapsed request time to integer milliseconds.
def elapsed_ms(start_time: float) -> int:
    return int((time.perf_counter() - start_time) * 1000)


# Log request metadata without label text, image bytes, or provider payloads.
def log_verify_request(
    *,
    latency_ms: int,
    content_type: str,
    metrics: LabelVerificationMetrics | None,
    status: str,
    overall_verdict: str | None,
) -> None:
    vision_metrics = metrics.vision_metrics if metrics else None
    logger.info(
        (
            "verify_request latency_ms=%s status=%s overall_verdict=%s "
            "content_type=%s original_image_bytes=%s optimized_image_bytes=%s "
            "optimized_dimensions=%s read_image_ms=%s preprocess_ms=%s "
            "vision_ms=%s compare_ms=%s"
        ),
        latency_ms,
        status,
        overall_verdict,
        content_type or "unknown",
        metrics.original_image_size if metrics else "unknown",
        getattr(vision_metrics, "optimized_bytes", "unknown"),
        format_optimized_dimensions(vision_metrics),
        metrics.read_image_ms if metrics else "unknown",
        getattr(vision_metrics, "preprocess_ms", "unknown"),
        getattr(vision_metrics, "vision_ms", "unknown"),
        metrics.compare_ms if metrics else "unknown",
    )


# Format optimized dimensions without exposing image content or filenames.
def format_optimized_dimensions(vision_metrics: object | None) -> str:
    width = getattr(vision_metrics, "optimized_width", None)
    height = getattr(vision_metrics, "optimized_height", None)
    if width is None or height is None:
        return "unknown"

    return f"{width}x{height}"
