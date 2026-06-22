import { useRef, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const MAX_BATCH_ITEMS = 5;

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

const INITIAL_FORM_VALUES = FIELD_DEFINITIONS.reduce((values, field) => {
    values[field.key] = "";
    return values;
}, {});

const FIELD_LABELS = FIELD_DEFINITIONS.reduce((labels, field) => {
    labels[field.key] = field.label;
    return labels;
}, {});

export default function App() {
    const [mode, setMode] = useState("single");
    const [singleValues, setSingleValues] = useState(INITIAL_FORM_VALUES);
    const [singleImage, setSingleImage] = useState(null);
    const [singleResult, setSingleResult] = useState(null);
    const [singleError, setSingleError] = useState("");
    const [isSingleVerifying, setIsSingleVerifying] = useState(false);
    const [batchItems, setBatchItems] = useState([createBatchItem()]);
    const [batchResult, setBatchResult] = useState(null);
    const [batchError, setBatchError] = useState("");
    const [isBatchVerifying, setIsBatchVerifying] = useState(false);
    const [showBatchProgress, setShowBatchProgress] = useState(false);

    async function handleSingleSubmit(event) {
        event.preventDefault();
        setSingleError("");

        const validationError = validateLabelInput(singleImage, singleValues);
        if (validationError) {
            setSingleError(validationError);
            return;
        }

        setIsSingleVerifying(true);
        setSingleResult(null);

        try {
            const formData = new FormData();
            formData.append("image", singleImage);
            formData.append("application_data", JSON.stringify(singleValues));

            const response = await fetch(`${API_BASE_URL}/verify`, {
                method: "POST",
                body: formData,
            });
            const data = await readResponseJson(response);

            if (!response.ok) {
                throw new Error(data.detail || "Could not verify the label. Please try again.");
            }

            setSingleResult(data);
        } catch (verifyError) {
            setSingleError(verifyError.message || "Could not verify the label. Please try again.");
        } finally {
            setIsSingleVerifying(false);
        }
    }

    async function handleBatchSubmit(event) {
        event.preventDefault();
        setBatchError("");

        const validationError = validateBatchInput(batchItems);
        if (validationError) {
            setBatchError(validationError);
            return;
        }

        setIsBatchVerifying(true);
        setBatchResult(null);
        setShowBatchProgress(false);
        const progressTimer = window.setTimeout(() => {
            setShowBatchProgress(true);
        }, 900);

        try {
            const formData = new FormData();
            batchItems.forEach((item) => {
                formData.append("images", item.image);
            });
            formData.append(
                "application_data",
                JSON.stringify(batchItems.map((item) => item.values)),
            );

            const response = await fetch(`${API_BASE_URL}/verify/batch`, {
                method: "POST",
                body: formData,
            });
            const data = await readResponseJson(response);

            if (!response.ok) {
                throw new Error(data.detail || "Could not verify the batch. Please try again.");
            }

            setBatchResult(data);
        } catch (verifyError) {
            setBatchError(verifyError.message || "Could not verify the batch. Please try again.");
        } finally {
            window.clearTimeout(progressTimer);
            setShowBatchProgress(false);
            setIsBatchVerifying(false);
        }
    }

    function updateSingleField(fieldKey, value) {
        setSingleValues((currentValues) => ({
            ...currentValues,
            [fieldKey]: value,
        }));
    }

    function updateBatchField(itemId, fieldKey, value) {
        setBatchItems((currentItems) =>
            currentItems.map((item) =>
                item.id === itemId
                    ? { ...item, values: { ...item.values, [fieldKey]: value } }
                    : item,
            ),
        );
    }

    function updateBatchImage(itemId, image) {
        setBatchItems((currentItems) =>
            currentItems.map((item) => (item.id === itemId ? { ...item, image } : item)),
        );
    }

    function addBatchItem() {
        setBatchItems((currentItems) =>
            currentItems.length >= MAX_BATCH_ITEMS
                ? currentItems
                : [...currentItems, createBatchItem()],
        );
    }

    function removeBatchItem(itemId) {
        setBatchItems((currentItems) =>
            currentItems.length === 1
                ? currentItems
                : currentItems.filter((item) => item.id !== itemId),
        );
    }

    return (
        <main className="page-shell">
            <section className="verification-panel" aria-labelledby="page-title">
                <h1 id="page-title">TTB Label Verification</h1>
                <p className="intro">
                    Upload label images and enter the application details.
                </p>

                <div className="mode-control">
                    <div
                        className={`mode-switch ${mode === "batch" ? "batch-selected" : ""}`}
                        aria-label="Verification mode"
                        title="Label upload mode"
                    >
                        <span className="mode-highlight" aria-hidden="true" />
                        <button
                            className={mode === "single" ? "mode-button active-mode" : "mode-button"}
                            type="button"
                            onClick={() => setMode("single")}
                        >
                            Single
                        </button>
                        <button
                            className={mode === "batch" ? "mode-button active-mode" : "mode-button"}
                            type="button"
                            onClick={() => setMode("batch")}
                        >
                            Batch
                        </button>
                    </div>
                </div>

                {mode === "single" ? (
                    <SingleLabelForm
                        error={singleError}
                        formValues={singleValues}
                        image={singleImage}
                        isVerifying={isSingleVerifying}
                        onFieldChange={updateSingleField}
                        onImageChange={setSingleImage}
                        onSubmit={handleSingleSubmit}
                        result={singleResult}
                    />
                ) : (
                    <BatchForm
                        batchItems={batchItems}
                        error={batchError}
                        isVerifying={isBatchVerifying}
                        onAddItem={addBatchItem}
                        onFieldChange={updateBatchField}
                        onImageChange={updateBatchImage}
                        onRemoveItem={removeBatchItem}
                        onSubmit={handleBatchSubmit}
                        result={batchResult}
                        showProgress={showBatchProgress}
                    />
                )}
            </section>
        </main>
    );
}

function SingleLabelForm({
    error,
    formValues,
    image,
    isVerifying,
    onFieldChange,
    onImageChange,
    onSubmit,
    result,
}) {
    return (
        <>
            <form className="verification-form" onSubmit={onSubmit}>
                <ImagePicker
                    image={image}
                    isDisabled={isVerifying}
                    label="Label Image"
                    onImageChange={onImageChange}
                />
                <FieldGrid
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
                <button className="verify-button" type="submit" disabled={isVerifying}>
                    {isVerifying ? "Verifying..." : "Verify Label"}
                </button>
            </form>

            {result && <ResultsView result={result} />}
        </>
    );
}

function BatchForm({
    batchItems,
    error,
    isVerifying,
    onAddItem,
    onFieldChange,
    onImageChange,
    onRemoveItem,
    onSubmit,
    result,
    showProgress,
}) {
    return (
        <>
            <form className="verification-form" onSubmit={onSubmit}>
                <div className="batch-list">
                    {batchItems.map((item, index) => (
                        <BatchItemCard
                            canRemove={batchItems.length > 1}
                            index={index}
                            isDisabled={isVerifying}
                            item={item}
                            key={item.id}
                            onFieldChange={onFieldChange}
                            onImageChange={onImageChange}
                            onRemoveItem={onRemoveItem}
                        />
                    ))}
                </div>

                <div className="batch-actions">
                    <button
                        className="secondary-button"
                        type="button"
                        onClick={onAddItem}
                        disabled={isVerifying || batchItems.length >= MAX_BATCH_ITEMS}
                    >
                        Add Label
                    </button>
                    <span>{batchItems.length} of {MAX_BATCH_ITEMS} labels</span>
                </div>

                <FormMessages
                    error={error}
                    isLoading={isVerifying}
                    loadingText={
                        showProgress
                            ? "This may take a little longer for multiple labels."
                            : `Verifying ${batchItems.length} labels...`
                    }
                />

                <button className="verify-button" type="submit" disabled={isVerifying}>
                    {isVerifying ? "Verifying Batch..." : "Verify Batch"}
                </button>
            </form>

            {result && <BatchResultsView result={result} />}
        </>
    );
}

function BatchItemCard({
    canRemove,
    index,
    isDisabled,
    item,
    onFieldChange,
    onImageChange,
    onRemoveItem,
}) {
    return (
        <section className="batch-card" aria-labelledby={`batch-label-${item.id}`}>
            <div className="batch-card-header">
                <h2 id={`batch-label-${item.id}`}>Label {index + 1}</h2>
                {canRemove ? (
                    <button
                        className="text-danger-button"
                        type="button"
                        onClick={() => onRemoveItem(item.id)}
                        disabled={isDisabled}
                    >
                        Remove
                    </button>
                ) : null}
            </div>
            <ImagePicker
                image={item.image}
                isDisabled={isDisabled}
                label="Label Image"
                onImageChange={(image) => onImageChange(item.id, image)}
            />
            <FieldGrid
                formValues={item.values}
                idPrefix={`batch-${item.id}`}
                isDisabled={isDisabled}
                onFieldChange={(fieldKey, value) => onFieldChange(item.id, fieldKey, value)}
            />
        </section>
    );
}

function ImagePicker({ image, isDisabled, label, onImageChange }) {
    const imageInputRef = useRef(null);

    function handleImageChange(event) {
        const nextImage = event.target.files?.[0];
        if (!nextImage) {
            return;
        }

        onImageChange(nextImage);
    }

    function openImagePicker() {
        if (imageInputRef.current) {
            imageInputRef.current.value = "";
            imageInputRef.current.click();
        }
    }

    function removeSelectedImage() {
        onImageChange(null);
        if (imageInputRef.current) {
            imageInputRef.current.value = "";
        }
    }

    return (
        <div className="upload-field">
            <span className="upload-label">{label}</span>
            <div className="upload-control">
                <button
                    className="file-button"
                    type="button"
                    onClick={openImagePicker}
                    disabled={isDisabled}
                >
                    Choose File
                </button>
                <span className="file-name">
                    {image ? image.name : "No file selected"}
                </span>
                {image ? (
                    <button
                        aria-label="Remove selected image"
                        className="remove-file-button"
                        title="Remove image"
                        type="button"
                        onClick={removeSelectedImage}
                        disabled={isDisabled}
                    >
                        x
                    </button>
                ) : null}
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

function FieldGrid({ formValues, idPrefix, isDisabled, onFieldChange }) {
    return (
        <div className="field-grid">
            {FIELD_DEFINITIONS.map((field) => (
                <div
                    className={field.multiline ? "field-row field-wide" : "field-row"}
                    key={field.key}
                >
                    <label htmlFor={`${idPrefix}-${field.key}`}>
                        {field.label}
                        {field.hint ? <span className="inline-hint">({field.hint})</span> : null}
                        {field.optional ? <span className="label-note">Optional if not on label</span> : null}
                    </label>
                    {field.multiline ? (
                        <textarea
                            id={`${idPrefix}-${field.key}`}
                            value={formValues[field.key]}
                            onChange={(event) => onFieldChange(field.key, event.target.value)}
                            disabled={isDisabled}
                            rows={5}
                        />
                    ) : (
                        <input
                            id={`${idPrefix}-${field.key}`}
                            type="text"
                            value={formValues[field.key]}
                            onChange={(event) => onFieldChange(field.key, event.target.value)}
                            disabled={isDisabled}
                        />
                    )}
                </div>
            ))}
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
            <div className={isApproved ? "verdict verdict-approved" : "verdict verdict-review"}>
                <span id="results-title">{isApproved ? "Approved" : "Needs Review"}</span>
                <small>Completed in {formatSeconds(result.latency_ms)} seconds</small>
            </div>

            <ResultFields results={result.results} />
        </section>
    );
}

function BatchResultsView({ result }) {
    return (
        <section className="results-panel" aria-labelledby="batch-results-title">
            <h2 id="batch-results-title" className="section-title">Batch Results</h2>
            <div className="summary-grid">
                <SummaryCard label="Passed" value={result.summary.passed} tone="passed" />
                <SummaryCard label="Needs Review" value={result.summary.needs_review} tone="review" />
                <SummaryCard label="Failed" value={result.summary.failed} tone="failed" />
                <SummaryCard label="Total" value={result.summary.total} tone="total" />
            </div>
            <p className="batch-time">Completed in {formatSeconds(result.latency_ms)} seconds</p>

            <div className="batch-results-list">
                {result.items.map((item) => (
                    <BatchResultItem item={item} key={item.index} />
                ))}
            </div>
        </section>
    );
}

function SummaryCard({ label, value, tone }) {
    return (
        <div className={`summary-card summary-${tone}`}>
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}

function BatchResultItem({ item }) {
    const [isOpen, setIsOpen] = useState(false);
    const verification = item.verification;
    const isApproved = verification?.overall_verdict === "APPROVED";
    const title = `Label ${item.index + 1}: ${item.filename}`;

    function handleHeaderClick() {
        if (!isOpen) {
            setIsOpen(true);
        }
    }

    function handleHeaderKeyDown(event) {
        if (!isOpen && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            setIsOpen(true);
        }
    }

    return (
        <article className={isOpen ? "batch-result-item is-open" : "batch-result-item"}>
            <div
                className="batch-result-summary"
                onClick={handleHeaderClick}
                onKeyDown={handleHeaderKeyDown}
                role={isOpen ? undefined : "button"}
                tabIndex={isOpen ? undefined : 0}
            >
                <span>{title}</span>
                <button
                    className="collapse-control"
                    type="button"
                    onClick={() => setIsOpen(false)}
                >
                    Collapse
                    <span className="collapse-arrow" aria-hidden="true" />
                </button>
                <strong className={item.status === "FAILED" ? "item-failed" : isApproved ? "item-approved" : "item-review"}>
                    {item.status === "FAILED" ? "Failed" : isApproved ? "Approved" : "Needs Review"}
                </strong>
            </div>
            {isOpen ? (
                item.status === "FAILED" ? (
                    <div className="message message-error">{item.error}</div>
                ) : (
                    <>
                        <p className="batch-time">
                            Completed in {formatSeconds(verification.latency_ms)} seconds
                        </p>
                        <ResultFields results={verification.results} />
                    </>
                )
            ) : null}
        </article>
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

function createBatchItem() {
    return {
        id: crypto.randomUUID(),
        image: null,
        values: { ...INITIAL_FORM_VALUES },
    };
}

function validateLabelInput(image, values) {
    if (!image) {
        return "Choose a label image before verifying.";
    }

    const missingRequiredField = FIELD_DEFINITIONS.some(
        (field) => !field.optional && !values[field.key].trim(),
    );
    if (missingRequiredField) {
        return "Fill in all required fields before verifying.";
    }

    return "";
}

function validateBatchInput(items) {
    for (const [index, item] of items.entries()) {
        const validationError = validateLabelInput(item.image, item.values);
        if (validationError) {
            return `Label ${index + 1}: ${validationError}`;
        }
    }

    return "";
}

async function readResponseJson(response) {
    return response.json().catch(() => ({}));
}

function displayValue(value) {
    return value || "Not found on label";
}

function formatSeconds(latencyMs) {
    return (latencyMs / 1000).toFixed(1);
}
