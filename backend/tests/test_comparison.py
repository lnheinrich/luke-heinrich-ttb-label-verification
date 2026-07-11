from app.comparison import verify_label
from app.models import ApplicationData, ExtractedLabel


CANONICAL_WARNING = (
    "GOVERNMENT WARNING: (1) ACCORDING TO THE SURGEON GENERAL, WOMEN SHOULD "
    "NOT DRINK ALCOHOLIC BEVERAGES DURING PREGNANCY BECAUSE OF THE RISK OF "
    "BIRTH DEFECTS. (2) CONSUMPTION OF ALCOHOLIC BEVERAGES IMPAIRS YOUR "
    "ABILITY TO DRIVE A CAR OR OPERATE MACHINERY, AND MAY CAUSE HEALTH "
    "PROBLEMS."
)


def make_application(**overrides: str) -> ApplicationData:
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
    return ApplicationData(**data)


def make_extracted(**overrides: str | None) -> ExtractedLabel:
    data = {
        "brand_name": "Mountain Creek",
        "class_type": "Whiskey",
        "abv": "45%",
        "net_contents": "750 mL",
        "producer": "Acme Distilling Co.",
        "country_of_origin": "USA",
        "government_warning": CANONICAL_WARNING,
        "raw_text": "label text",
        "extraction_confidence": 0.96,
    }
    data.update(overrides)
    return ExtractedLabel(**data)


def result_for_field(result, field: str):
    return next(field_result for field_result in result.results if field_result.field == field)


# Verifies model contracts for required application fields and nullable extraction fields.
def test_models_accept_required_application_and_nullable_extraction() -> None:
    application = make_application()
    extracted = make_extracted(raw_text=None, extraction_confidence=None, producer=None)

    assert application.brand_name == "Mountain Creek"
    assert extracted.producer is None
    assert extracted.raw_text is None
    assert extracted.extraction_confidence is None


# Verifies brand matching ignores casing for fuzzy text fields.
def test_case_only_brand_difference_passes() -> None:
    result = verify_label(
        make_application(brand_name="Mountain Creek"),
        make_extracted(brand_name="MOUNTAIN CREEK"),
    )

    assert result_for_field(result, "brand_name").status == "PASS"


# Verifies fuzzy fields tolerate punctuation, casing, and spacing differences.
def test_fuzzy_text_fields_pass_with_punctuation_and_spacing_differences() -> None:
    result = verify_label(
        make_application(
            brand_name="Mountain Creek",
            class_type="Straight Bourbon Whiskey",
            producer="Acme Distilling Co.",
        ),
        make_extracted(
            brand_name="mountain-creek",
            class_type="Straight  Bourbon, Whiskey",
            producer="ACME DISTILLING CO",
        ),
    )

    assert result_for_field(result, "brand_name").status == "PASS"
    assert result_for_field(result, "class_type").status == "PASS"
    assert result_for_field(result, "producer").status == "PASS"


# Verifies brand matching allows extra descriptive label text around the brand.
def test_brand_name_passes_when_found_contains_expected_core_brand() -> None:
    result = verify_label(
        make_application(brand_name="Jack Daniels"),
        make_extracted(brand_name="Jack Daniel's Old No. 7 Brand"),
    )

    assert result_for_field(result, "brand_name").status == "PASS"


# Verifies class matching allows longer extracted class phrases.
def test_class_type_passes_when_found_contains_expected_class() -> None:
    result = verify_label(
        make_application(class_type="Whiskey"),
        make_extracted(class_type="Tennessee SOUR MASH WHISKEY"),
    )

    assert result_for_field(result, "class_type").status == "PASS"


# Verifies class matching treats whisky and whiskey as spelling variants.
def test_class_type_whisky_matches_whiskey_label_text() -> None:
    result = verify_label(
        make_application(class_type="whisky"),
        make_extracted(class_type="Tennessee SOUR MASH WHISKEY"),
    )

    assert result_for_field(result, "class_type").status == "PASS"


# Verifies producer matching allows extra producer/facility wording on the label.
def test_producer_passes_when_found_contains_expected_producer_name() -> None:
    result = verify_label(
        make_application(producer="Jack Daniels"),
        make_extracted(producer="JACK DANIEL DISTILLERY"),
    )

    assert result_for_field(result, "producer").status == "PASS"


# Verifies clearly different fuzzy text values fail and require review.
def test_fuzzy_text_field_mismatch_fails() -> None:
    result = verify_label(
        make_application(brand_name="Mountain Creek"),
        make_extracted(brand_name="Harbor Valley"),
    )

    assert result_for_field(result, "brand_name").status == "FAIL"
    assert result.overall_verdict == "NEEDS_REVIEW"


# Verifies tiny application values do not pass by matching one character in a longer label.
def test_short_brand_value_does_not_pass_containment_match() -> None:
    result = verify_label(
        make_application(brand_name="s"),
        make_extracted(brand_name="Coors LIGHT"),
    )

    assert result_for_field(result, "brand_name").status == "FAIL"


# Verifies short values can still pass when the extracted value is exactly the same.
def test_short_brand_value_passes_exact_normalized_match() -> None:
    result = verify_label(
        make_application(brand_name="s"),
        make_extracted(brand_name="S"),
    )

    assert result_for_field(result, "brand_name").status == "PASS"


# Verifies country aliases normalize before comparison.
def test_country_synonym_usa_vs_united_states_passes() -> None:
    result = verify_label(
        make_application(country_of_origin="USA"),
        make_extracted(country_of_origin="United States"),
    )

    assert result_for_field(result, "country_of_origin").status == "PASS"


# Verifies America is treated as a user-entered synonym for the United States.
def test_country_synonym_america_vs_u_s_a_passes() -> None:
    result = verify_label(
        make_application(country_of_origin="America"),
        make_extracted(country_of_origin="U.S.A."),
    )

    assert result_for_field(result, "country_of_origin").status == "PASS"


# Verifies different countries fail after normalization.
def test_country_mismatch_fails() -> None:
    result = verify_label(
        make_application(country_of_origin="USA"),
        make_extracted(country_of_origin="Canada"),
    )

    assert result_for_field(result, "country_of_origin").status == "FAIL"


# Verifies ABV parsing ignores surrounding alcohol/proof text.
def test_abv_percent_vs_alc_vol_and_proof_passes() -> None:
    result = verify_label(
        make_application(abv="45%"),
        make_extracted(abv="45% Alc./Vol. (90 Proof)"),
    )

    assert result_for_field(result, "abv").status == "PASS"


# Verifies a standalone proof value converts to half its number as ABV.
def test_abv_standalone_proof_converts_to_abv() -> None:
    result = verify_label(
        make_application(abv="45%"),
        make_extracted(abv="90 Proof"),
    )

    assert result_for_field(result, "abv").status == "PASS"


# Verifies ABV differences outside tolerance fail.
def test_abv_outside_tolerance_fails() -> None:
    result = verify_label(
        make_application(abv="45%"),
        make_extracted(abv="45.2% Alc./Vol."),
    )

    assert result_for_field(result, "abv").status == "FAIL"


# Verifies invalid or absent extracted ABV values fail.
def test_abv_invalid_or_missing_extracted_value_fails() -> None:
    invalid_result = verify_label(make_application(abv="45%"), make_extracted(abv="strong"))
    missing_result = verify_label(make_application(abv="45%"), make_extracted(abv=None))

    assert result_for_field(invalid_result, "abv").status == "FAIL"
    assert result_for_field(missing_result, "abv").status == "FAIL"
    assert result_for_field(missing_result, "abv").found is None


# Verifies net contents matching ignores spacing between amount and unit.
def test_net_contents_750_ml_vs_750ml_passes() -> None:
    result = verify_label(
        make_application(net_contents="750 mL"),
        make_extracted(net_contents="750ml"),
    )

    assert result_for_field(result, "net_contents").status == "PASS"


# Verifies supported net content units normalize to milliliters.
def test_net_contents_unit_normalization_passes() -> None:
    liter_result = verify_label(
        make_application(net_contents="750 mL"),
        make_extracted(net_contents="0.75 L"),
    )
    centiliter_result = verify_label(
        make_application(net_contents="750 mL"),
        make_extracted(net_contents="75 cl"),
    )

    assert result_for_field(liter_result, "net_contents").status == "PASS"
    assert result_for_field(centiliter_result, "net_contents").status == "PASS"


# Verifies mismatched or unsupported net content values fail.
def test_net_contents_mismatch_or_unsupported_unit_fails() -> None:
    mismatch_result = verify_label(
        make_application(net_contents="750 mL"),
        make_extracted(net_contents="700 mL"),
    )
    unsupported_result = verify_label(
        make_application(net_contents="750 mL"),
        make_extracted(net_contents="1 pint"),
    )

    assert result_for_field(mismatch_result, "net_contents").status == "FAIL"
    assert result_for_field(unsupported_result, "net_contents").status == "FAIL"


# Verifies US fluid ounce spellings normalize to milliliters.
def test_net_contents_fluid_ounces_normalize_to_ml() -> None:
    fl_oz_result = verify_label(
        make_application(net_contents="355 mL"),
        make_extracted(net_contents="12 fl oz"),
    )
    dotted_result = verify_label(
        make_application(net_contents="355 mL"),
        make_extracted(net_contents="12 FL. OZ."),
    )
    bare_oz_result = verify_label(
        make_application(net_contents="355 mL"),
        make_extracted(net_contents="12 oz"),
    )

    assert result_for_field(fl_oz_result, "net_contents").status == "PASS"
    assert result_for_field(dotted_result, "net_contents").status == "PASS"
    assert result_for_field(bare_oz_result, "net_contents").status == "PASS"


# Verifies the canonical all-caps government warning passes exactly.
def test_correct_all_caps_government_warning_passes() -> None:
    result = verify_label(
        make_application(government_warning=CANONICAL_WARNING),
        make_extracted(government_warning=CANONICAL_WARNING),
    )

    assert result_for_field(result, "government_warning").status == "PASS"


# Verifies the mandatory warning fails when absent from both application and label.
def test_blank_government_warning_fails_when_extracted_warning_missing() -> None:
    result = verify_label(
        make_application(government_warning=""),
        make_extracted(government_warning=None),
    )

    field_result = result_for_field(result, "government_warning")
    assert field_result.status == "FAIL"
    assert field_result.found is None


# Verifies blank expected warning fails if the label has warning text.
def test_blank_government_warning_fails_when_extracted_warning_exists() -> None:
    result = verify_label(
        make_application(government_warning=""),
        make_extracted(government_warning=CANONICAL_WARNING),
    )

    assert result_for_field(result, "government_warning").status == "FAIL"


# Verifies warning comparison permits whitespace-only differences.
def test_government_warning_whitespace_collapse_passes() -> None:
    spaced_warning = CANONICAL_WARNING.replace("WARNING:", "WARNING:\n\n")

    result = verify_label(
        make_application(government_warning=CANONICAL_WARNING),
        make_extracted(government_warning=spaced_warning),
    )

    assert result_for_field(result, "government_warning").status == "PASS"


# Verifies warning comparison is case-sensitive.
def test_government_warning_title_case_fails() -> None:
    title_case_warning = CANONICAL_WARNING.title()

    result = verify_label(
        make_application(government_warning=CANONICAL_WARNING),
        make_extracted(government_warning=title_case_warning),
    )

    field_result = result_for_field(result, "government_warning")
    assert field_result.status == "FAIL"
    assert field_result.found == title_case_warning


# Verifies warning comparison does not repair missing punctuation.
def test_government_warning_missing_colon_fails() -> None:
    warning_without_colon = CANONICAL_WARNING.replace("GOVERNMENT WARNING:", "GOVERNMENT WARNING")

    result = verify_label(
        make_application(government_warning=CANONICAL_WARNING),
        make_extracted(government_warning=warning_without_colon),
    )

    assert result_for_field(result, "government_warning").status == "FAIL"


# Verifies warning OCR failures preserve the extracted text.
def test_misread_government_warning_returns_extracted_text() -> None:
    misread_warning = CANONICAL_WARNING.replace("SURGEON", "S0RGEON")

    result = verify_label(
        make_application(government_warning=CANONICAL_WARNING),
        make_extracted(government_warning=misread_warning),
    )

    field_result = result_for_field(result, "government_warning")
    assert field_result.status == "FAIL"
    assert field_result.found == misread_warning


# Verifies the aggregate verdict approves only all-pass results.
def test_overall_verdict_approved_when_all_fields_pass() -> None:
    result = verify_label(make_application(), make_extracted())

    assert result.overall_verdict == "APPROVED"
    assert all(field_result.status == "PASS" for field_result in result.results)


# Verifies any failed field changes the aggregate verdict to review.
def test_overall_verdict_needs_review_when_any_field_fails() -> None:
    result = verify_label(
        make_application(),
        make_extracted(producer="Different Producer"),
    )

    assert result.overall_verdict == "NEEDS_REVIEW"
