import { useRef, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const FIELD_DEFINITIONS = [
    { key: "brand_name", label: "Brand Name" },
    { key: "class_type", label: "Class / Type" },
    { key: "abv", label: "Alcohol Content" },
    { key: "net_contents", label: "Bottle Size" },
    { key: "producer", label: "Producer" },
    { key: "country_of_origin", label: "Country of Origin" },
    {
        key: "government_warning",
        label: "Government Warning",
        multiline: true,
        optional: true,
    },
];

const INITIAL_FORM_VALUES = FIELD_DEFINITIONS.reduce((values, field) => {
    values[field.key] = "";
    return values;
}, {});

const FIELD_LABELS = FIELD_DEFINITIONS.reduce((labels, field) => {
    labels[field.key] = field.label;
    return labels;
}, {});

export default function App() {
    const [formValues, setFormValues] = useState(INITIAL_FORM_VALUES);
    const [selectedImage, setSelectedImage] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState("");
    const [isVerifying, setIsVerifying] = useState(false);
    const imageInputRef = useRef(null);

    function updateField(fieldKey, value) {
        setFormValues((currentValues) => ({
            ...currentValues,
            [fieldKey]: value,
        }));
    }

    function handleImageChange(event) {
        setSelectedImage(event.target.files?.[0] || null);
        setError("");
    }

    async function handleSubmit(event) {
        event.preventDefault();
        setError("");

        if (!selectedImage) {
            setError("Choose a label image before verifying.");
            return;
        }

        const missingRequiredField = FIELD_DEFINITIONS.some(
            (field) => !field.optional && !formValues[field.key].trim(),
        );
        if (missingRequiredField) {
            setError("Fill in all required fields before verifying.");
            return;
        }

        setIsVerifying(true);
        setResult(null);

        try {
            const formData = new FormData();
            formData.append("image", selectedImage);
            formData.append("application_data", JSON.stringify(formValues));

            const response = await fetch(`${API_BASE_URL}/verify`, {
                method: "POST",
                body: formData,
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(data.detail || "Could not verify the label. Please try again.");
            }

            setResult(data);
        } catch (verifyError) {
            setError(verifyError.message || "Could not verify the label. Please try again.");
        } finally {
            setIsVerifying(false);
        }
    }

    return (
        <main className="page-shell">
            <section className="verification-panel" aria-labelledby="page-title">
                <p className="eyebrow">TTB Label Verification</p>
                <h1 id="page-title">Check One Label</h1>
                <p className="intro">
                    Upload a label image and enter the application details.
                </p>

                <form className="verification-form" onSubmit={handleSubmit}>
                    <div className="upload-field">
                        <span className="upload-label">Label Image</span>
                        <div className="upload-control">
                            <button
                                className="file-button"
                                type="button"
                                onClick={() => imageInputRef.current?.click()}
                                disabled={isVerifying}
                            >
                                Choose File
                            </button>
                            <span className="file-name">
                                {selectedImage ? selectedImage.name : "No file selected"}
                            </span>
                        </div>
                        <input
                            ref={imageInputRef}
                            className="hidden-file-input"
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={handleImageChange}
                            disabled={isVerifying}
                            tabIndex={-1}
                        />
                    </div>

                    <div className="field-grid">
                        {FIELD_DEFINITIONS.map((field) => (
                            <div
                                className={field.multiline ? "field-row field-wide" : "field-row"}
                                key={field.key}
                            >
                                <label htmlFor={field.key}>
                                    {field.label}
                                    {field.optional ? <span>Optional if not on label</span> : null}
                                </label>
                                {field.multiline ? (
                                    <textarea
                                        id={field.key}
                                        value={formValues[field.key]}
                                        onChange={(event) => updateField(field.key, event.target.value)}
                                        disabled={isVerifying}
                                        rows={5}
                                    />
                                ) : (
                                    <input
                                        id={field.key}
                                        type="text"
                                        value={formValues[field.key]}
                                        onChange={(event) => updateField(field.key, event.target.value)}
                                        disabled={isVerifying}
                                    />
                                )}
                            </div>
                        ))}
                    </div>

                    {error && (
                        <div className="message message-error" role="alert">
                            {error}
                        </div>
                    )}

                    {isVerifying && (
                        <div className="message message-loading" role="status">
                            Reading the label image. This may take a few seconds.
                        </div>
                    )}

                    <button className="verify-button" type="submit" disabled={isVerifying}>
                        {isVerifying ? "Verifying..." : "Verify Label"}
                    </button>
                </form>

                {result && <ResultsView result={result} />}
            </section>
        </main>
    );
}

function ResultsView({ result }) {
    const isApproved = result.overall_verdict === "APPROVED";

    return (
        <section className="results-panel" aria-labelledby="results-title">
            <div className={isApproved ? "verdict verdict-approved" : "verdict verdict-review"}>
                <span id="results-title">{isApproved ? "Approved" : "Needs Review"}</span>
                <small>Completed in {formatSeconds(result.latency_ms)} seconds</small>
            </div>

            <div className="result-list">
                {result.results.map((fieldResult) => (
                    <FieldResultRow fieldResult={fieldResult} key={fieldResult.field} />
                ))}
            </div>
        </section>
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

function displayValue(value) {
    return value || "Not found on label";
}

function formatSeconds(latencyMs) {
    return (latencyMs / 1000).toFixed(1);
}
