from typing import Literal

from typing_extensions import Annotated

from pydantic import BaseModel, StringConstraints


FieldStatus = Literal["PASS", "FAIL"]
OverallVerdict = Literal["APPROVED", "NEEDS_REVIEW"]
BatchItemStatus = Literal["COMPLETED", "FAILED"]
RequiredText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
OptionalText = Annotated[str, StringConstraints(strip_whitespace=True)]


# User-entered application values used as the comparison source of truth.
class ApplicationData(BaseModel):
    brand_name: RequiredText
    class_type: RequiredText
    abv: RequiredText
    net_contents: RequiredText
    producer: RequiredText
    country_of_origin: RequiredText
    government_warning: OptionalText


# Vision-extracted label values, nullable because OCR may miss fields.
class ExtractedLabel(BaseModel):
    brand_name: str | None = None
    class_type: str | None = None
    abv: str | None = None
    net_contents: str | None = None
    producer: str | None = None
    country_of_origin: str | None = None
    government_warning: str | None = None
    raw_text: str | None = None
    extraction_confidence: float | None = None


# Per-field comparison output shown to users and API callers.
class FieldResult(BaseModel):
    field: str
    match_type: str
    expected: str
    found: str | None
    status: FieldStatus


# Full verification response with field results and the aggregate verdict.
class VerificationResult(BaseModel):
    results: list[FieldResult]
    overall_verdict: OverallVerdict
    latency_ms: int


# One batch item result, preserving item order and isolating item-level failures.
class BatchItemResult(BaseModel):
    index: int
    filename: str
    status: BatchItemStatus
    verification: VerificationResult | None = None
    error: str | None = None


# Aggregate counts for a completed batch request.
class BatchSummary(BaseModel):
    passed: int
    needs_review: int
    failed: int
    total: int


# Full batch response with item drill-down and aggregate timing.
class BatchResult(BaseModel):
    items: list[BatchItemResult]
    summary: BatchSummary
    latency_ms: int
