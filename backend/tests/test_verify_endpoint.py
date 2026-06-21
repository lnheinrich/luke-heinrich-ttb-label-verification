import json
import logging
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError

from app.main import validation_exception_handler, verify
from app.models import ExtractedLabel
from app.vision import VisionInputError, VisionProviderError


CANONICAL_WARNING = (
    "GOVERNMENT WARNING: (1) ACCORDING TO THE SURGEON GENERAL, WOMEN SHOULD "
    "NOT DRINK ALCOHOLIC BEVERAGES DURING PREGNANCY BECAUSE OF THE RISK OF "
    "BIRTH DEFECTS. (2) CONSUMPTION OF ALCOHOLIC BEVERAGES IMPAIRS YOUR "
    "ABILITY TO DRIVE A CAR OR OPERATE MACHINERY, AND MAY CAUSE HEALTH "
    "PROBLEMS."
)


class FakeVisionService:
    def __init__(
        self,
        extracted: ExtractedLabel | None = None,
        exception: Exception | None = None,
    ) -> None:
        self.extracted = extracted or make_extracted()
        self.exception = exception
        self.calls = []

    def extract_label(self, image_bytes: bytes, mime_type: str) -> ExtractedLabel:
        self.calls.append({"image_bytes": image_bytes, "mime_type": mime_type})
        if self.exception:
            raise self.exception

        return self.extracted


class FakeUploadFile:
    def __init__(
        self,
        image_bytes: bytes = b"fake-image-bytes",
        content_type: str = "image/jpeg",
    ) -> None:
        self.image_bytes = image_bytes
        self.content_type = content_type

    async def read(self) -> bytes:
        return self.image_bytes


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


# Build valid application data for endpoint requests.
def make_application_data(**overrides: str) -> dict[str, str]:
    data = {
        "brand_name": "Mountain Creek",
        "class_type": "Whiskey",
        "abv": "45%",
        "net_contents": "750 mL",
        "producer": "Acme Distilling Co.",
        "country_of_origin": "USA",
        "government_warning": CANONICAL_WARNING,
    }
    data.update(overrides)
    return data


# Build extracted label data returned by the fake vision service.
def make_extracted(**overrides: str | None) -> ExtractedLabel:
    data = {
        "brand_name": "Mountain Creek",
        "class_type": "Whiskey",
        "abv": "45% Alc./Vol. (90 Proof)",
        "net_contents": "750ml",
        "producer": "Acme Distilling Co.",
        "country_of_origin": "United States",
        "government_warning": CANONICAL_WARNING,
        "raw_text": "Mountain Creek Whiskey",
        "extraction_confidence": 0.94,
    }
    data.update(overrides)
    return ExtractedLabel(**data)


# Build an upload object with the endpoint surface used in production.
def make_upload(
    image_bytes: bytes = b"fake-image-bytes",
    content_type: str = "image/jpeg",
):
    return FakeUploadFile(image_bytes=image_bytes, content_type=content_type)


# Call the endpoint with valid defaults and overridable inputs.
async def call_verify(
    *,
    fake_service: FakeVisionService | None = None,
    application_data=None,
    image_bytes: bytes = b"fake-image-bytes",
    content_type: str = "image/jpeg",
):
    if application_data is None:
        application_data = make_application_data()

    return await verify(
        image=make_upload(image_bytes=image_bytes, content_type=content_type),
        application_data=(
            application_data
            if isinstance(application_data, str)
            else json.dumps(application_data)
        ),
        vision_service=fake_service or FakeVisionService(),
    )


# Verifies a valid request returns a full approved VerificationResult.
@pytest.mark.anyio
async def test_verify_success_returns_full_verification_result() -> None:
    fake_service = FakeVisionService()

    result = await call_verify(fake_service=fake_service)
    warning_result = next(
        field for field in result.results if field.field == "government_warning"
    )

    assert result.overall_verdict == "APPROVED"
    assert isinstance(result.latency_ms, int)
    assert result.latency_ms >= 0
    assert len(result.results) == 7
    assert warning_result.expected == CANONICAL_WARNING
    assert warning_result.found == CANONICAL_WARNING
    assert fake_service.calls[0]["image_bytes"] == b"fake-image-bytes"
    assert fake_service.calls[0]["mime_type"] == "image/jpeg"


# Verifies one extracted mismatch changes the verdict to review.
@pytest.mark.anyio
async def test_verify_mismatch_returns_needs_review() -> None:
    fake_service = FakeVisionService(extracted=make_extracted(producer="Other Producer"))

    result = await call_verify(fake_service=fake_service)
    producer_result = next(field for field in result.results if field.field == "producer")

    assert result.overall_verdict == "NEEDS_REVIEW"
    assert producer_result.status == "FAIL"
    assert producer_result.expected == "Acme Distilling Co."
    assert producer_result.found == "Other Producer"


# Verifies warning failures surface the extracted warning text.
@pytest.mark.anyio
async def test_verify_warning_mismatch_surfaces_extracted_warning() -> None:
    extracted_warning = "Government Warning missing exact casing"
    fake_service = FakeVisionService(
        extracted=make_extracted(government_warning=extracted_warning)
    )

    result = await call_verify(fake_service=fake_service)
    warning_result = next(
        field for field in result.results if field.field == "government_warning"
    )

    assert result.overall_verdict == "NEEDS_REVIEW"
    assert warning_result.status == "FAIL"
    assert warning_result.found == extracted_warning


# Verifies missing multipart fields return a readable validation error.
@pytest.mark.anyio
async def test_verify_missing_multipart_fields_return_readable_422() -> None:
    request = SimpleNamespace(url=SimpleNamespace(path="/verify"))

    response = await validation_exception_handler(request, RequestValidationError([]))

    assert response.status_code == 422
    assert json.loads(response.body)["detail"] == (
        "Request must include image and application_data."
    )


# Verifies empty application data returns a readable validation error.
@pytest.mark.anyio
async def test_verify_empty_application_data_returns_422_without_vision_call() -> None:
    fake_service = FakeVisionService()

    with pytest.raises(HTTPException) as exc_info:
        await call_verify(fake_service=fake_service, application_data="")

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == (
        "Application data must be valid JSON with all required fields."
    )
    assert fake_service.calls == []


# Verifies invalid JSON returns a readable validation error.
@pytest.mark.anyio
async def test_verify_invalid_json_returns_422_without_vision_call() -> None:
    fake_service = FakeVisionService()

    with pytest.raises(HTTPException) as exc_info:
        await call_verify(fake_service=fake_service, application_data="{not json")

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == (
        "Application data must be valid JSON with all required fields."
    )
    assert fake_service.calls == []


# Verifies missing required fields return a readable validation error.
@pytest.mark.anyio
async def test_verify_missing_required_field_returns_422_without_vision_call() -> None:
    fake_service = FakeVisionService()
    application_data = make_application_data()
    del application_data["brand_name"]

    with pytest.raises(HTTPException) as exc_info:
        await call_verify(fake_service=fake_service, application_data=application_data)

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == (
        "Application data must be valid JSON with all required fields."
    )
    assert fake_service.calls == []


# Verifies empty required fields return a readable validation error.
@pytest.mark.anyio
async def test_verify_empty_required_field_returns_422_without_vision_call() -> None:
    fake_service = FakeVisionService()

    with pytest.raises(HTTPException) as exc_info:
        await call_verify(
            fake_service=fake_service,
            application_data=make_application_data(brand_name=""),
        )

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == (
        "Application data must be valid JSON with all required fields."
    )
    assert fake_service.calls == []


# Verifies empty image uploads fail before extraction.
@pytest.mark.anyio
async def test_verify_empty_image_returns_400_without_vision_call() -> None:
    fake_service = FakeVisionService()

    with pytest.raises(HTTPException) as exc_info:
        await call_verify(fake_service=fake_service, image_bytes=b"")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Image file is empty."
    assert fake_service.calls == []


# Verifies unsupported file types fail before extraction.
@pytest.mark.anyio
async def test_verify_unsupported_image_type_returns_400_without_vision_call() -> None:
    fake_service = FakeVisionService()

    with pytest.raises(HTTPException) as exc_info:
        await call_verify(fake_service=fake_service, content_type="text/plain")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Unsupported image type. Use JPEG, PNG, or WebP."
    assert fake_service.calls == []


# Verifies oversized uploads fail before extraction.
@pytest.mark.anyio
async def test_verify_oversized_image_returns_413_without_vision_call(monkeypatch) -> None:
    fake_service = FakeVisionService()
    monkeypatch.setattr("app.main.MAX_IMAGE_BYTES", 10)

    with pytest.raises(HTTPException) as exc_info:
        await call_verify(fake_service=fake_service, image_bytes=b"x" * 11)

    assert exc_info.value.status_code == 413
    assert exc_info.value.detail == "Image is too large. Maximum size is 10 MB."
    assert fake_service.calls == []


# Verifies vision input errors are shaped as readable client errors.
@pytest.mark.anyio
async def test_verify_vision_input_error_returns_422() -> None:
    fake_service = FakeVisionService(exception=VisionInputError("bad image"))

    with pytest.raises(HTTPException) as exc_info:
        await call_verify(fake_service=fake_service)

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "Could not read the label image. Try a clearer photo."


# Verifies provider failures are shaped as readable upstream errors.
@pytest.mark.anyio
async def test_verify_provider_error_returns_502() -> None:
    fake_service = FakeVisionService(exception=VisionProviderError("timeout"))

    with pytest.raises(HTTPException) as exc_info:
        await call_verify(fake_service=fake_service)

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "Label extraction is temporarily unavailable. Try again."


# Verifies successful verification logs latency without label text.
@pytest.mark.anyio
async def test_verify_logs_latency_without_sensitive_label_text(caplog) -> None:
    caplog.set_level(logging.INFO)

    result = await call_verify()
    log_text = caplog.text

    assert result.overall_verdict == "APPROVED"
    assert "verify_request latency_ms=" in log_text
    assert "overall_verdict=APPROVED" in log_text
    assert "Mountain Creek" not in log_text
    assert "GOVERNMENT WARNING" not in log_text
