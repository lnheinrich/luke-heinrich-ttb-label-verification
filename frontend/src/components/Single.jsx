import { useEffect, useRef } from "react";
import { FieldGrid, requiredFieldsComplete } from "./fields";
import { FormMessages, ImagePreview, ResultFields, TileFileName, formatSeconds } from "./shared";

export default function Single({
    error,
    flashMissingInputs,
    formValues,
    image,
    isVerifying,
    onFieldChange,
    onImageChange,
    onSubmit,
    result,
}) {
    const isComplete = isSingleLabelComplete(image, formValues);

    return (
        <>
            <form className="verification-form" onSubmit={onSubmit}>
                <div className="single-form-header">
                    <h2>Label Details</h2>
                    <span className={isComplete ? "editor-status editor-complete" : "editor-status editor-incomplete"}>
                        {isComplete ? "Ready" : "Incomplete"}
                    </span>
                </div>
                <SingleImageSection
                    image={image}
                    isDisabled={isVerifying}
                    onImageChange={onImageChange}
                />
                <FieldGrid
                    flashMissingInputs={flashMissingInputs}
                    formValues={formValues}
                    idPrefix="single"
                    isDisabled={isVerifying}
                    onFieldChange={onFieldChange}
                />
                <FormMessages
                    error={error}
                    isLoading={isVerifying}
                    loadingText="Reading the label image. This may take a few seconds."
                />
                <button
                    className={isComplete ? "verify-button" : "verify-button verify-button-incomplete"}
                    type="submit"
                    disabled={isVerifying}
                >
                    {isVerifying ? "Verifying..." : "Verify Label"}
                </button>
            </form>

            {result && <ResultsView result={result} />}
        </>
    );
}

function SingleImageSection({ image, isDisabled, onImageChange }) {
    const imageInputRef = useRef(null);

    function handleImageChange(event) {
        const nextImage = event.target.files?.[0];
        if (!nextImage) {
            return;
        }

        onImageChange(nextImage);
        event.target.value = "";
    }

    function handleImageControlClick() {
        if (image) {
            onImageChange(null);
            return;
        }

        if (imageInputRef.current) {
            imageInputRef.current.value = "";
            imageInputRef.current.click();
        }
    }

    return (
        <div className="expanded-image-section">
            <button
                aria-label={image ? "Remove label image" : "Add label image"}
                className={image ? "expanded-image-control has-image-preview" : "expanded-image-control empty-image-preview"}
                type="button"
                title={image ? undefined : "Select image file"}
                onClick={handleImageControlClick}
                disabled={isDisabled}
            >
                {image ? (
                    <>
                        <ImagePreview image={image} />
                        <span className="preview-remove-overlay">Remove</span>
                    </>
                ) : (
                    <span className="preview-add-icon" aria-hidden="true" />
                )}
            </button>
            <div className="expanded-image-meta">
                <span className="upload-label">Label Image</span>
                <TileFileName fileName={image?.name || ""} />
            </div>
            <input
                ref={imageInputRef}
                className="hidden-file-input"
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                disabled={isDisabled}
                tabIndex={-1}
            />
        </div>
    );
}

function ResultsView({ result }) {
    const headingRef = useRef(null);
    const isApproved = result.overall_verdict === "APPROVED";

    // Move focus to the outcome so keyboard and screen-reader users are not
    // left below the fold after the result renders.
    useEffect(() => {
        if (headingRef.current) {
            headingRef.current.focus({ preventScroll: true });
            headingRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }, [result]);

    return (
        <section className="results-panel" aria-labelledby="results-title">
            <h2 id="results-title" className="section-title result-title-line" ref={headingRef} tabIndex={-1}>
                Label Result:
                <span className={isApproved ? "single-result-pill single-result-approved" : "single-result-pill single-result-review"}>
                    {isApproved ? "Approved" : "Needs Review"}
                </span>
            </h2>
            <p className="batch-time">Completed in {formatSeconds(result.latency_ms)} seconds</p>

            <ResultFields results={result.results} />
        </section>
    );
}

function isSingleLabelComplete(image, values) {
    return Boolean(image) && requiredFieldsComplete(values);
}
