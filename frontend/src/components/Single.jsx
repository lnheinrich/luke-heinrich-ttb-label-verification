import { useEffect, useRef, useState } from "react";

const FIELD_DEFINITIONS = [
    { key: "brand_name", label: "Brand Name" },
    { key: "class_type", label: "Class / Type" },
    { key: "abv", label: "Alcohol Content" },
    { key: "net_contents", label: "Bottle Size", hint: "include units" },
    { key: "producer", label: "Producer" },
    { key: "country_of_origin", label: "Country of Origin" },
    {
        key: "government_warning",
        label: "Government Warning",
        multiline: true,
        optional: true,
    },
];

const FIELD_LABELS = FIELD_DEFINITIONS.reduce((labels, field) => {
    labels[field.key] = field.label;
    return labels;
}, {});

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
                accept="image/jpeg,image/png,image/webp"
                onChange={handleImageChange}
                disabled={isDisabled}
                tabIndex={-1}
            />
        </div>
    );
}

function TileFileName({ fileName }) {
    const fileNameRef = useRef(null);
    const [isTruncated, setIsTruncated] = useState(false);

    useEffect(() => {
        function updateTruncationState() {
            const element = fileNameRef.current;
            setIsTruncated(Boolean(element && element.scrollWidth > element.clientWidth));
        }

        updateTruncationState();
        window.addEventListener("resize", updateTruncationState);

        return () => {
            window.removeEventListener("resize", updateTruncationState);
        };
    }, [fileName]);

    return (
        <span
            className={fileName ? "tile-file-name" : "tile-file-name empty-file-name"}
            ref={fileNameRef}
            title={isTruncated ? fileName : undefined}
        >
            {fileName}
        </span>
    );
}

function ImagePreview({ image }) {
    const [previewUrl, setPreviewUrl] = useState("");

    useEffect(() => {
        const nextPreviewUrl = URL.createObjectURL(image);
        setPreviewUrl(nextPreviewUrl);

        return () => {
            URL.revokeObjectURL(nextPreviewUrl);
        };
    }, [image]);

    return <img alt="" src={previewUrl} />;
}

function FieldGrid({ flashMissingInputs = false, formValues, idPrefix, isDisabled, onFieldChange }) {
    return (
        <div className="field-grid">
            {FIELD_DEFINITIONS.map((field) => {
                const shouldFlashField = flashMissingInputs && !field.optional && !formValues[field.key].trim();
                const inputClassName = shouldFlashField ? "missing-input-flash" : undefined;
                const inputId = `${idPrefix}-${field.key}`;

                return (
                    <div
                        className={field.multiline ? "field-row field-wide" : "field-row"}
                        key={field.key}
                    >
                        <label htmlFor={inputId}>
                            {field.label}
                            {field.hint ? <span className="inline-hint">({field.hint})</span> : null}
                            {field.optional ? <span className="label-note">Optional if not on label</span> : null}
                        </label>
                        {field.multiline ? (
                            <textarea
                                className={inputClassName}
                                id={inputId}
                                value={formValues[field.key]}
                                onChange={(event) => onFieldChange(field.key, event.target.value)}
                                disabled={isDisabled}
                                rows={5}
                            />
                        ) : (
                            <input
                                className={inputClassName}
                                id={inputId}
                                type="text"
                                value={formValues[field.key]}
                                onChange={(event) => onFieldChange(field.key, event.target.value)}
                                disabled={isDisabled}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function FormMessages({ error, isLoading, loadingText }) {
    return (
        <>
            {error && (
                <div className="message message-error" role="alert">
                    {error}
                </div>
            )}

            {isLoading && (
                <div className="message message-loading" role="status">
                    {loadingText}
                </div>
            )}
        </>
    );
}

function ResultsView({ result }) {
    const isApproved = result.overall_verdict === "APPROVED";

    return (
        <section className="results-panel" aria-labelledby="results-title">
            <h2 id="results-title" className="section-title result-title-line">
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

function ResultFields({ results }) {
    return (
        <div className="result-list">
            {results.map((fieldResult) => (
                <FieldResultRow fieldResult={fieldResult} key={fieldResult.field} />
            ))}
        </div>
    );
}

function FieldResultRow({ fieldResult }) {
    const didPass = fieldResult.status === "PASS";

    return (
        <article className={didPass ? "result-row result-pass" : "result-row result-fail"}>
            <div className="result-heading">
                <h2>{FIELD_LABELS[fieldResult.field] || fieldResult.field}</h2>
                <span className={didPass ? "status-pill pass-pill" : "status-pill fail-pill"}>
                    {didPass ? "PASS" : "FAIL"}
                </span>
            </div>
            <dl className="comparison-values">
                <div>
                    <dt>Application says</dt>
                    <dd>{displayValue(fieldResult.expected)}</dd>
                </div>
                <div>
                    <dt>Label shows</dt>
                    <dd>{displayValue(fieldResult.found)}</dd>
                </div>
            </dl>
        </article>
    );
}

function isSingleLabelComplete(image, values) {
    return Boolean(image) && requiredFieldsComplete(values);
}

function requiredFieldsComplete(values) {
    return FIELD_DEFINITIONS.every(
        (field) => field.optional || values[field.key].trim(),
    );
}

function displayValue(value) {
    return value || "Not found on label";
}

function formatSeconds(latencyMs) {
    return (latencyMs / 1000).toFixed(1);
}
