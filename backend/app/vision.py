import os
from io import BytesIO
from typing import Any

from google import genai
from google.genai import types
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import ValidationError

from app.models import ExtractedLabel


DEFAULT_VISION_MODEL = "gemini-2.5-flash"
DEFAULT_TIMEOUT_SECONDS = 10.0
MAX_IMAGE_DIMENSION = 1280
JPEG_QUALITY = 80

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
        self.model = model or os.getenv("GOOGLEAI_MODEL", DEFAULT_VISION_MODEL)
        self.timeout_seconds = timeout_seconds

    # Preprocess an image, send it to the vision model, and validate the result.
    def extract_label(self, image_bytes: bytes, mime_type: str) -> ExtractedLabel:
        try:
            image_part = image_bytes_to_inline_part(image_bytes)
        except VisionServiceError:
            raise
        except Exception as exc:
            raise VisionInputError("Image preprocessing failed") from exc

        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=[EXTRACTION_PROMPT, image_part],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=ExtractedLabel,
                    temperature=0,
                    http_options=types.HttpOptions(
                        timeout=int(self.timeout_seconds * 1000),
                    ),
                ),
            )
            return extract_parsed_label(response)
        except VisionServiceError:
            raise
        except (ValidationError, ValueError, TypeError) as exc:
            raise VisionProviderError("Vision response did not match ExtractedLabel") from exc
        except Exception as exc:
            raise VisionProviderError("Vision model request failed") from exc


# Build the Google client from the project-specific API key variable.
def build_google_client() -> genai.Client:
    api_key = os.getenv("GOOGLEAI_API_KEY")
    if not api_key:
        raise VisionProviderError("GOOGLEAI_API_KEY is not configured")

    return genai.Client(api_key=api_key)


# Convert arbitrary supported image bytes into an optimized inline image part.
def image_bytes_to_inline_part(image_bytes: bytes) -> types.Part:
    jpeg_bytes = preprocess_image(image_bytes)

    return types.Part(
        inline_data=types.Blob(
            data=jpeg_bytes,
            mime_type="image/jpeg",
        )
    )


# Downscale and re-encode an image for lower-latency vision requests.
def preprocess_image(image_bytes: bytes) -> bytes:
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
            return output.getvalue()
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
