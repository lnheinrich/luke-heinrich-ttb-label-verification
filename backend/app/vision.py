import os
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from io import BytesIO
from typing import Any

from dotenv import load_dotenv
from google import genai
from google.genai import types
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import ValidationError

from app.models import ExtractedLabel


# Load .env before the module-level config reads below; main.py loads it too,
# but only after this module has already been imported.
load_dotenv()

DEFAULT_VISION_MODEL = os.getenv("GOOGLEAI_MODEL", "gemini-2.5-flash")
DEFAULT_TIMEOUT_SECONDS = float(os.getenv("VISION_TIMEOUT_SECONDS", "4.5"))
MAX_IMAGE_DIMENSION = int(os.getenv("MAX_IMAGE_DIMENSION", "1024"))
JPEG_QUALITY = int(os.getenv("JPEG_QUALITY", "75"))
# Gemini 2.5 Flash "thinks" by default, which dominates request latency.
# Label extraction is OCR-like and does not need reasoning, so thinking is
# disabled by default; set -1 to restore the model's dynamic thinking.
VISION_THINKING_BUDGET = int(os.getenv("VISION_THINKING_BUDGET", "0"))
# Google's API rejects request deadlines shorter than this.
GOOGLE_MIN_DEADLINE_SECONDS = 10.0

EXTRACTION_PROMPT = """
You are extracting text from an alcohol beverage label for TTB label review.

Return only the structured fields requested by the schema.
Extract only text that is visible on the label image.
Use null for any field that is absent, obscured, unreadable, or uncertain.

Fields to extract:
- brand_name
- class_type
- abv
- net_contents
- producer
- country_of_origin
- government_warning
- raw_text
- extraction_confidence

For government_warning, copy the exact visible warning text verbatim.
Preserve casing, punctuation, colon, parentheses, spelling, word order, and line text.
Do not repair, normalize, complete, or infer the government warning.
If the warning is partially visible or likely misread, return the visible or misread text exactly.

For blurry, angled, glare-obscured, partial, or non-label images, return partial data with nulls.
Do not fail only because the image is low quality or not a beverage label.
Set extraction_confidence from 0.0 to 1.0, using lower values for partial or uncertain extraction.
""".strip()


@dataclass(frozen=True)
class ImagePreprocessResult:
    image_bytes: bytes
    original_bytes: int
    optimized_bytes: int
    optimized_width: int
    optimized_height: int
    preprocess_ms: int


@dataclass(frozen=True)
class VisionRequestMetrics:
    original_bytes: int
    optimized_bytes: int
    optimized_width: int
    optimized_height: int
    preprocess_ms: int
    vision_ms: int


class VisionServiceError(Exception):
    """Raised when image preprocessing or model extraction fails."""


class VisionInputError(VisionServiceError):
    """Raised when image bytes cannot be processed."""


class VisionProviderError(VisionServiceError):
    """Raised when the model provider or structured response fails."""


class VisionService:
    # Extract label fields from an image using an injectable Google Gen AI client.
    def __init__(
        self,
        client: Any | None = None,
        model: str | None = None,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self.client = client or build_google_client()
        self.model = model or DEFAULT_VISION_MODEL
        self.timeout_seconds = timeout_seconds
        self.last_metrics: VisionRequestMetrics | None = None

    # Preprocess an image, send it to the vision model, and validate the result.
    def extract_label(self, image_bytes: bytes, mime_type: str) -> ExtractedLabel:
        self.last_metrics = None
        try:
            image_part, preprocess_result = image_bytes_to_inline_part_with_metrics(image_bytes)
        except VisionServiceError:
            raise
        except Exception as exc:
            raise VisionInputError("Image preprocessing failed") from exc

        vision_start = time.perf_counter()
        # Google rejects request deadlines under 10s, so timeouts below that
        # are enforced locally by waiting on the SDK call in a worker thread.
        executor = ThreadPoolExecutor(max_workers=1)
        try:
            future = executor.submit(
                self.client.models.generate_content,
                model=self.model,
                contents=[EXTRACTION_PROMPT, image_part],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=ExtractedLabel,
                    temperature=0,
                    thinking_config=types.ThinkingConfig(
                        thinking_budget=VISION_THINKING_BUDGET,
                    ),
                    http_options=types.HttpOptions(
                        timeout=int(max(self.timeout_seconds, GOOGLE_MIN_DEADLINE_SECONDS) * 1000),
                    ),
                ),
            )
            response = future.result(timeout=self.timeout_seconds)
            label = extract_parsed_label(response)
            self.last_metrics = VisionRequestMetrics(
                original_bytes=preprocess_result.original_bytes,
                optimized_bytes=preprocess_result.optimized_bytes,
                optimized_width=preprocess_result.optimized_width,
                optimized_height=preprocess_result.optimized_height,
                preprocess_ms=preprocess_result.preprocess_ms,
                vision_ms=elapsed_ms(vision_start),
            )
            return label
        except VisionServiceError:
            raise
        except FutureTimeoutError as exc:
            raise VisionProviderError("Vision model request timed out") from exc
        except (ValidationError, ValueError, TypeError) as exc:
            raise VisionProviderError("Vision response did not match ExtractedLabel") from exc
        except Exception as exc:
            raise VisionProviderError("Vision model request failed") from exc
        finally:
            executor.shutdown(wait=False, cancel_futures=True)


# Build the Google client from the project-specific API key variable.
def build_google_client() -> genai.Client:
    api_key = os.getenv("GOOGLEAI_API_KEY")
    if not api_key:
        raise VisionProviderError("GOOGLEAI_API_KEY is not configured")

    return genai.Client(api_key=api_key)


# Convert arbitrary supported image bytes into an optimized inline image part.
def image_bytes_to_inline_part(image_bytes: bytes) -> types.Part:
    image_part, _ = image_bytes_to_inline_part_with_metrics(image_bytes)

    return image_part


# Convert image bytes into an inline part while preserving preprocessing metrics.
def image_bytes_to_inline_part_with_metrics(
    image_bytes: bytes,
) -> tuple[types.Part, ImagePreprocessResult]:
    preprocess_result = preprocess_image_with_metrics(image_bytes)

    return (
        types.Part(
            inline_data=types.Blob(
                data=preprocess_result.image_bytes,
                mime_type="image/jpeg",
            )
        ),
        preprocess_result,
    )


# Downscale and re-encode an image for lower-latency vision requests.
def preprocess_image(image_bytes: bytes) -> bytes:
    return preprocess_image_with_metrics(image_bytes).image_bytes


# Downscale and re-encode an image with metadata for performance logging.
def preprocess_image_with_metrics(image_bytes: bytes) -> ImagePreprocessResult:
    preprocess_start = time.perf_counter()
    try:
        with Image.open(BytesIO(image_bytes)) as image:
            image = ImageOps.exif_transpose(image)
            image = convert_to_rgb(image)
            image.thumbnail(
                (MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION),
                Image.Resampling.LANCZOS,
            )

            output = BytesIO()
            image.save(output, format="JPEG", quality=JPEG_QUALITY, optimize=True)
            optimized_bytes = output.getvalue()
            return ImagePreprocessResult(
                image_bytes=optimized_bytes,
                original_bytes=len(image_bytes),
                optimized_bytes=len(optimized_bytes),
                optimized_width=image.width,
                optimized_height=image.height,
                preprocess_ms=elapsed_ms(preprocess_start),
            )
    except UnidentifiedImageError as exc:
        raise VisionInputError("Invalid or unsupported image bytes") from exc


# Normalize image modes before JPEG encoding.
def convert_to_rgb(image: Image.Image) -> Image.Image:
    if image.mode in {"RGBA", "LA"}:
        background = Image.new("RGB", image.size, "white")
        background.paste(image, mask=image.getchannel("A"))
        return background

    return image.convert("RGB")


# Read the parsed Pydantic object from a Google Gen AI structured response.
def extract_parsed_label(response: Any) -> ExtractedLabel:
    parsed = getattr(response, "parsed", None)
    if parsed is not None:
        return validate_extracted_label(parsed)

    raise VisionProviderError("Vision response did not include parsed output")


# Validate fake-client dictionaries and SDK parsed model instances the same way.
def validate_extracted_label(value: Any) -> ExtractedLabel:
    if isinstance(value, ExtractedLabel):
        return value

    return ExtractedLabel.model_validate(value)


# Convert elapsed work time to integer milliseconds for coarse diagnostics.
def elapsed_ms(start_time: float) -> int:
    return int((time.perf_counter() - start_time) * 1000)
