from io import BytesIO
from types import SimpleNamespace

import pytest
from PIL import Image

from app.models import ExtractedLabel
from app.vision import (
    EXTRACTION_PROMPT,
    MAX_IMAGE_DIMENSION,
    VisionService,
    VisionServiceError,
    image_bytes_to_inline_part,
    preprocess_image,
)


class FakeModels:
    def __init__(self, parsed=None, exception: Exception | None = None) -> None:
        self.parsed = parsed
        self.exception = exception
        self.calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        if self.exception:
            raise self.exception

        return SimpleNamespace(parsed=self.parsed)


class FakeClient:
    def __init__(self, parsed=None, exception: Exception | None = None) -> None:
        self.models = FakeModels(parsed=parsed, exception=exception)


# Build an in-memory image fixture for preprocessing and request tests.
def make_image_bytes(
    size: tuple[int, int] = (400, 300),
    image_format: str = "PNG",
    mode: str = "RGB",
) -> bytes:
    image = Image.new(mode, size, "white")
    output = BytesIO()
    image.save(output, format=image_format)
    return output.getvalue()


# Verifies large inputs are downscaled before model submission.
def test_preprocess_downscales_oversized_image_to_jpeg() -> None:
    jpeg_bytes = preprocess_image(make_image_bytes(size=(2400, 1600)))

    with Image.open(BytesIO(jpeg_bytes)) as image:
        assert image.format == "JPEG"
        assert max(image.size) == MAX_IMAGE_DIMENSION


# Verifies small images are not enlarged during preprocessing.
def test_preprocess_does_not_upscale_small_image() -> None:
    jpeg_bytes = preprocess_image(make_image_bytes(size=(320, 240)))

    with Image.open(BytesIO(jpeg_bytes)) as image:
        assert image.size == (320, 240)


# Verifies PNG input is accepted and normalized to JPEG output.
def test_preprocess_accepts_png_and_emits_jpeg() -> None:
    jpeg_bytes = preprocess_image(make_image_bytes(image_format="PNG"))

    with Image.open(BytesIO(jpeg_bytes)) as image:
        assert image.format == "JPEG"


# Verifies corrupt images fail before any model call is made.
def test_corrupt_image_raises_service_error_before_client_call() -> None:
    fake_client = FakeClient(parsed=ExtractedLabel())
    service = VisionService(client=fake_client)

    with pytest.raises(VisionServiceError):
        service.extract_label(b"not an image", "image/jpeg")

    assert fake_client.models.calls == []


# Verifies the model request contains image input, prompt, model, timeout, and schema config.
def test_extract_label_request_uses_image_prompt_and_structured_output() -> None:
    parsed = ExtractedLabel(brand_name="Mountain Creek", extraction_confidence=0.9)
    fake_client = FakeClient(parsed=parsed)
    service = VisionService(client=fake_client, model="test-vision-model", timeout_seconds=3)

    result = service.extract_label(make_image_bytes(), "image/png")

    call = fake_client.models.calls[0]
    prompt, image_part = call["contents"]
    config = call["config"]

    assert result.brand_name == "Mountain Creek"
    assert call["model"] == "test-vision-model"
    assert prompt == EXTRACTION_PROMPT
    assert image_part.inline_data.mime_type == "image/jpeg"
    assert config.response_mime_type == "application/json"
    assert config.response_schema is ExtractedLabel
    assert config.temperature == 0
    assert config.http_options.timeout == 3000


# Verifies successful parsed output is returned as an ExtractedLabel.
def test_extract_label_returns_parsed_extracted_label() -> None:
    parsed = ExtractedLabel(
        brand_name="Mountain Creek",
        class_type="Whiskey",
        abv="45%",
        net_contents="750 mL",
        producer="Acme Distilling Co.",
        country_of_origin="USA",
        government_warning="GOVERNMENT WARNING:",
        raw_text="Mountain Creek Whiskey",
        extraction_confidence=0.94,
    )
    service = VisionService(client=FakeClient(parsed=parsed))

    result = service.extract_label(make_image_bytes(), "image/png")

    assert result == parsed


# Verifies unknown fields remain null after structured validation.
def test_extract_label_preserves_unknown_fields_as_none() -> None:
    service = VisionService(
        client=FakeClient(
            parsed={
                "brand_name": "Mountain Creek",
                "class_type": None,
                "abv": None,
                "net_contents": None,
                "producer": None,
                "country_of_origin": None,
                "government_warning": None,
                "raw_text": "Mountain Creek",
                "extraction_confidence": 0.4,
            }
        )
    )

    result = service.extract_label(make_image_bytes(), "image/png")

    assert result.brand_name == "Mountain Creek"
    assert result.abv is None
    assert result.government_warning is None


# Verifies non-label images return partial/null data instead of raising.
def test_non_label_response_returns_null_fields_and_low_confidence() -> None:
    service = VisionService(
        client=FakeClient(
            parsed=ExtractedLabel(raw_text=None, extraction_confidence=0.05)
        )
    )

    result = service.extract_label(make_image_bytes(), "image/png")

    assert result.brand_name is None
    assert result.government_warning is None
    assert result.extraction_confidence == 0.05


# Verifies blurry or partial label responses can return partial fields.
def test_partial_response_returns_partial_data_not_exception() -> None:
    service = VisionService(
        client=FakeClient(
            parsed=ExtractedLabel(
                brand_name="Mountain Creek",
                abv=None,
                raw_text="Mountain Creek",
                extraction_confidence=0.35,
            )
        )
    )

    result = service.extract_label(make_image_bytes(), "image/png")

    assert result.brand_name == "Mountain Creek"
    assert result.abv is None
    assert result.extraction_confidence == 0.35


# Verifies warning text is preserved exactly as provided by structured output.
def test_government_warning_is_preserved_verbatim() -> None:
    warning = "Government Warning (1) ACCORD1NG TO THE SURGEON GENERAL"
    service = VisionService(
        client=FakeClient(parsed=ExtractedLabel(government_warning=warning))
    )

    result = service.extract_label(make_image_bytes(), "image/png")

    assert result.government_warning == warning


# Verifies invalid parsed data is wrapped in a service error.
def test_invalid_structured_response_raises_service_error() -> None:
    service = VisionService(
        client=FakeClient(parsed={"brand_name": "Mountain Creek", "extraction_confidence": "high"})
    )

    with pytest.raises(VisionServiceError):
        service.extract_label(make_image_bytes(), "image/png")


# Verifies timeout or API client failures are wrapped in a service error.
def test_client_exception_raises_service_error() -> None:
    service = VisionService(client=FakeClient(exception=TimeoutError("request timed out")))

    with pytest.raises(VisionServiceError):
        service.extract_label(make_image_bytes(), "image/png")


# Verifies inline image helper always returns a JPEG part.
def test_image_bytes_to_inline_part_returns_jpeg_part() -> None:
    part = image_bytes_to_inline_part(make_image_bytes())

    assert part.inline_data.mime_type == "image/jpeg"
    assert part.inline_data.data.startswith(b"\xff\xd8")
