from typing import Literal

from pydantic import BaseModel


FieldStatus = Literal["PASS", "FAIL"]
OverallVerdict = Literal["APPROVED", "NEEDS_REVIEW"]


# User-entered application values used as the comparison source of truth.
class ApplicationData(BaseModel):
    brand_name: str
    class_type: str
    abv: str
    net_contents: str
    producer: str
    country_of_origin: str
    government_warning: str


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
