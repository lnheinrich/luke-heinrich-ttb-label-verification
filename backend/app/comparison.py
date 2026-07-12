import re
import string

from rapidfuzz import fuzz
from app.models import ApplicationData, ExtractedLabel, FieldResult, VerificationResult


FUZZY_THRESHOLD = 90
FUZZY_CONTAINS_THRESHOLD = 90
MIN_FUZZY_CONTAINS_CHARS = 5
ABV_TOLERANCE = 0.1

COUNTRY_ALIASES = {
    "america": "united states",
    "us": "united states",
    "usa": "united states",
    "u s": "united states",
    "u s a": "united states",
    "united states": "united states",
    "united states of america": "united states",
    "uk": "united kingdom",
    "u k": "united kingdom",
    "united kingdom": "united kingdom",
    "great britain": "united kingdom",
    "britain": "united kingdom",
    "france": "france",
    "italy": "italy",
    "italia": "italy",
    "spain": "spain",
    "espana": "spain",
    "españa": "spain",
    "germany": "germany",
    "deutschland": "germany",
    "portugal": "portugal",
    "australia": "australia",
}

UNIT_TO_ML = {
    "ml": 1,
    "milliliter": 1,
    "milliliters": 1,
    "l": 1000,
    "liter": 1000,
    "liters": 1000,
    "cl": 10,
    "floz": 29.5735,
    "oz": 29.5735,
}


# Run all field comparisons and derive the aggregate label verdict.
def verify_label(
    application: ApplicationData,
    extracted: ExtractedLabel,
    latency_ms: int = 0,
) -> VerificationResult:
    results = [
        compare_fuzzy_contains("brand_name", application.brand_name, extracted.brand_name),
        compare_fuzzy_contains("class_type", application.class_type, extracted.class_type),
        compare_abv(application.abv, extracted.abv),
        compare_net_contents(application.net_contents, extracted.net_contents),
        compare_fuzzy_contains("producer", application.producer, extracted.producer),
        compare_country(application.country_of_origin, extracted.country_of_origin),
        compare_government_warning(
            application.government_warning,
            extracted.government_warning,
        ),
    ]
    overall_verdict = (
        "NEEDS_REVIEW"
        if any(result.status == "FAIL" for result in results)
        else "APPROVED"
    )  # any failed field requires review

    return VerificationResult(
        results=results,
        overall_verdict=overall_verdict,
        latency_ms=latency_ms,
    )


# Compare normalized text fields using the configured fuzzy threshold.
def compare_fuzzy_text(field: str, expected: str, found: str | None) -> FieldResult:
    if found is None:
        return build_result(field, "fuzzy", expected, found, "FAIL")

    expected_normalized = normalize_text(expected)
    found_normalized = normalize_text(found)
    score = fuzzy_ratio(expected_normalized, found_normalized)
    status = "PASS" if score >= FUZZY_THRESHOLD else "FAIL"

    return build_result(field, "fuzzy", expected, found, status)


# Compare text fields where the extracted value may include extra label text.
def compare_fuzzy_contains(field: str, expected: str, found: str | None) -> FieldResult:
    if found is None:
        return build_result(field, "fuzzy_contains", expected, found, "FAIL")

    expected_normalized = normalize_fuzzy_contains_text(field, expected)
    found_normalized = normalize_fuzzy_contains_text(field, found)
    if len(expected_normalized) < MIN_FUZZY_CONTAINS_CHARS:
        status = "PASS" if expected_normalized == found_normalized else "FAIL"
        return build_result(field, "fuzzy_contains", expected, found, status)

    status = (
        "PASS"
        if expected_normalized in found_normalized
        or fuzzy_ratio(expected_normalized, found_normalized) >= FUZZY_THRESHOLD
        or fuzzy_partial_ratio(expected_normalized, found_normalized) >= FUZZY_CONTAINS_THRESHOLD
        else "FAIL"
    )  # expected may be a shorter application value than the full label phrase

    return build_result(field, "fuzzy_contains", expected, found, status)


# Compare country values after mapping common aliases to canonical names.
def compare_country(expected: str, found: str | None) -> FieldResult:
    if found is None:
        return build_result("country_of_origin", "country_synonym", expected, found, "FAIL")

    expected_normalized = normalize_country(expected)
    found_normalized = normalize_country(found)
    status = "PASS" if expected_normalized == found_normalized else "FAIL"

    return build_result("country_of_origin", "country_synonym", expected, found, status)


# Compare ABV values as numeric percentages with a small tolerance.
def compare_abv(expected: str, found: str | None) -> FieldResult:
    if found is None:
        return build_result("abv", "numeric_tolerance", expected, found, "FAIL")

    expected_value = parse_abv(expected)
    found_value = parse_abv(found)
    status = (
        "PASS"
        if expected_value is not None
        and found_value is not None
        and abs(expected_value - found_value) <= ABV_TOLERANCE
        else "FAIL"
    )

    return build_result("abv", "numeric_tolerance", expected, found, status)


# Compare package sizes after converting supported units to milliliters.
def compare_net_contents(expected: str, found: str | None) -> FieldResult:
    if found is None:
        return build_result("net_contents", "unit_normalized", expected, found, "FAIL")

    expected_ml = parse_net_contents_ml(expected)
    found_ml = parse_net_contents_ml(found)
    status = (
        "PASS"
        if expected_ml is not None
        and found_ml is not None
        and abs(expected_ml - found_ml) <= 1.0
        else "FAIL"
    )

    return build_result("net_contents", "unit_normalized", expected, found, status)


# Compare the government warning exactly after whitespace collapse only.
def compare_government_warning(expected: str, found: str | None) -> FieldResult:
    expected_collapsed = collapse_whitespace(expected)
    if found is None:
        # The TTB warning is legally mandatory: a missing extraction always
        # fails, even when the application side is also empty.
        return build_result("government_warning", "exact", expected, found, "FAIL")

    status = "PASS" if expected_collapsed == collapse_whitespace(found) else "FAIL"  # case-sensitive

    return build_result("government_warning", "exact", expected, found, status)


# Build a consistent result object for every comparison strategy.
def build_result(
    field: str,
    match_type: str,
    expected: str,
    found: str | None,
    status: str,
) -> FieldResult:
    return FieldResult(
        field=field,
        match_type=match_type,
        expected=expected,
        found=found,
        status=status,
    )


# Normalize punctuation, case, and whitespace for fuzzy text matching.
def normalize_text(value: str) -> str:
    translation = str.maketrans({character: " " for character in string.punctuation})
    return collapse_whitespace(value.lower().translate(translation))


# Normalize a country string and apply known synonym mappings.
def normalize_country(value: str) -> str:
    normalized = normalize_text(value)
    return COUNTRY_ALIASES.get(normalized, normalized)


# Normalize fields that need extra synonym handling before containment matching.
def normalize_fuzzy_contains_text(field: str, value: str) -> str:
    normalized = normalize_text(value)
    if field == "class_type":
        return normalize_class_type(normalized)

    return normalized


# Treat common whiskey/whisky spelling variants as the same class token.
def normalize_class_type(value: str) -> str:
    return re.sub(r"\bwhisky\b", "whiskey", value)


# Return the RapidFuzz ratio score for two normalized strings.
def fuzzy_ratio(expected: str, found: str) -> float:
    return float(fuzz.ratio(expected, found))


# Return the RapidFuzz partial ratio score for containment-like matches.
def fuzzy_partial_ratio(expected: str, found: str) -> float:
    return float(fuzz.partial_ratio(expected, found))


# Extract the first numeric alcohol percentage from a label string.
def parse_abv(value: str) -> float | None:
    percent_match = re.search(r"(\d+(?:\.\d+)?)\s*%", value)
    if percent_match:
        return float(percent_match.group(1))

    proof_match = re.search(r"(\d+(?:\.\d+)?)\s*proof", value, flags=re.IGNORECASE)
    if proof_match:
        return float(proof_match.group(1)) / 2

    number_match = re.search(r"\d+(?:\.\d+)?", value)
    if number_match:
        return float(number_match.group(0))

    return None


# Parse a package size and return the equivalent number of milliliters.
def parse_net_contents_ml(value: str) -> float | None:
    match = re.search(
        r"(\d+(?:\.\d+)?)\s*(milliliters?|ml|liters?|l|cl|fl\.?\s*oz|oz)\b",
        value,
        flags=re.IGNORECASE,
    )
    if not match:
        return None

    amount = float(match.group(1))
    # Strip dots and spaces so "fl oz", "fl. oz.", and "FL.OZ" all key as "floz".
    unit = re.sub(r"[.\s]", "", match.group(2).lower())

    return amount * UNIT_TO_ML[unit]


# Collapse whitespace without changing casing or punctuation.
def collapse_whitespace(value: str) -> str:
    return " ".join(value.split())
