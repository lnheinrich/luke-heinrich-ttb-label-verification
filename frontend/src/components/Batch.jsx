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

export default function Batch({
    activeItemId,
    batchItems,
    error,
    flashingIncompleteItemIds,
    isVerifying,
    onActiveItemChange,
    onAddEmptyLabel,
    onAddImages,
    onFieldChange,
    onImageChange,
    onRemoveItem,
    onSubmit,
    result,
    showProgress,
}) {
    const batchFormRef = useRef(null);
    const hasIncompleteLabels = batchItems.some((item) => !isBatchItemComplete(item));

    return (
        <>
            <form className="verification-form" onSubmit={onSubmit} ref={batchFormRef}>
                <BatchAccordionList
                    activeItemId={activeItemId}
                    batchFormRef={batchFormRef}
                    flashingIncompleteItemIds={flashingIncompleteItemIds}
                    hasBatchResults={Boolean(result)}
                    isDisabled={isVerifying}
                    items={batchItems}
                    onAddEmptyLabel={onAddEmptyLabel}
                    onAddImages={onAddImages}
                    onFieldChange={onFieldChange}
                    onImageChange={onImageChange}
                    onRemoveItem={onRemoveItem}
                    onToggleItem={onActiveItemChange}
                />

                <FormMessages
                    error={error}
                    isLoading={isVerifying}
                    loadingText={
                        showProgress
                            ? "This may take a little longer for multiple labels."
                            : `Verifying ${batchItems.length} labels...`
                    }
                />

                <button
                    className={hasIncompleteLabels ? "verify-button verify-button-incomplete" : "verify-button"}
                    type="submit"
                    disabled={isVerifying}
                >
                    {isVerifying ? "Verifying Batch..." : "Verify Batch"}
                </button>
            </form>

            {result && <BatchResultsView result={result} />}
        </>
    );
}

function BatchAccordionList({
    activeItemId,
    batchFormRef,
    flashingIncompleteItemIds,
    hasBatchResults,
    isDisabled,
    items,
    onAddEmptyLabel,
    onAddImages,
    onFieldChange,
    onImageChange,
    onRemoveItem,
    onToggleItem,
}) {
    const addImagesInputRef = useRef(null);
    const itemRefs = useRef({});
    const hasIncompleteItems = items.some((item) => !isBatchItemComplete(item));
    const hasSingleItem = items.length === 1;

    function handleAddImagesChange(event) {
        onAddImages(event.target.files);
        event.target.value = "";
    }

    function openAddImagesPicker() {
        addImagesInputRef.current?.click();
    }

    function registerItemRef(itemId, element) {
        if (element) {
            itemRefs.current[itemId] = element;
            return;
        }

        delete itemRefs.current[itemId];
    }

    function handleNextIncomplete(currentItemId) {
        const nextIncompleteItemId = getNextIncompleteItemId(items, currentItemId);
        if (!nextIncompleteItemId) {
            onToggleItem(null);
            window.setTimeout(() => {
                if (hasBatchResults && batchFormRef.current) {
                    scrollElementBottomToViewportBottom(batchFormRef.current);
                    return;
                }

                scrollToPageBottomIfScrollable();
            }, 260);
            return;
        }

        onToggleItem(nextIncompleteItemId);
        window.setTimeout(() => {
            const nextElement = itemRefs.current[nextIncompleteItemId];
            if (nextElement) {
                scrollTileToViewportOffset(nextElement, 20);
            }
        }, 240);
    }

    return (
        <>
            <div className="batch-toolbar">
                <h2>Batch Labels</h2>
                <div className="batch-actions">
                    <button
                        className="secondary-button"
                        type="button"
                        onClick={openAddImagesPicker}
                        disabled={isDisabled}
                        title="Select one or more images to generate label entries."
                    >
                        Add Images
                    </button>
                    <span>{items.length} labels</span>
                    <input
                        ref={addImagesInputRef}
                        className="hidden-file-input"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        onChange={handleAddImagesChange}
                        disabled={isDisabled}
                        tabIndex={-1}
                    />
                </div>
            </div>

            <div className="batch-label-list">
                {items.map((item, index) => (
                    <BatchAccordionItem
                        index={index}
                        hasIncompleteItems={hasIncompleteItems}
                        hasSingleItem={hasSingleItem}
                        isDisabled={isDisabled}
                        isExpanded={item.id === activeItemId}
                        item={item}
                        key={item.id}
                        onNextIncomplete={handleNextIncomplete}
                        onFieldChange={onFieldChange}
                        onImageChange={onImageChange}
                        onRemoveItem={onRemoveItem}
                        registerItemRef={registerItemRef}
                        shouldFlashIncomplete={flashingIncompleteItemIds.includes(item.id)}
                        onToggleItem={onToggleItem}
                    />
                ))}
            </div>

            <div className="add-empty-label-row">
                <button
                    className="add-empty-label-button"
                    type="button"
                    onClick={onAddEmptyLabel}
                    disabled={isDisabled}
                >
                    Add Empty Label
                </button>
            </div>
        </>
    );
}

function BatchAccordionItem({
    index,
    hasIncompleteItems,
    hasSingleItem,
    isDisabled,
    isExpanded,
    item,
    onNextIncomplete,
    onFieldChange,
    onImageChange,
    onRemoveItem,
    registerItemRef,
    shouldFlashIncomplete,
    onToggleItem,
}) {
    const imageInputRef = useRef(null);
    const isComplete = isBatchItemComplete(item);
    const shouldShowFinish = hasSingleItem || !hasIncompleteItems;

    function handleChangeImage(event) {
        const nextImage = event.target.files?.[0];
        if (nextImage) {
            onImageChange(item.id, nextImage);
        }
        event.target.value = "";
    }

    function handleImageControlClick() {
        if (item.image) {
            onImageChange(item.id, null);
            return;
        }

        imageInputRef.current?.click();
    }

    function handleHeaderClick() {
        onToggleItem(isExpanded ? null : item.id);
    }

    function handleNextIncompleteClick() {
        if (hasSingleItem && !isComplete) {
            return;
        }

        onNextIncomplete(item.id);
    }

    return (
        <article
            className={getBatchAccordionItemClassName({
                isComplete,
                isExpanded,
                shouldFlashIncomplete,
            })}
            ref={(element) => registerItemRef(item.id, element)}
        >
            <div className="batch-accordion-header">
                <button
                    aria-expanded={isExpanded}
                    className="batch-accordion-toggle"
                    type="button"
                    onClick={handleHeaderClick}
                    disabled={isDisabled}
                >
                    <span className="accordion-title">
                        Label {index + 1}
                        <span className="accordion-arrow" aria-hidden="true" />
                    </span>
                    <span className={isComplete ? "editor-status editor-complete" : "editor-status editor-incomplete"}>
                        {isComplete ? "Ready" : "Incomplete"}
                    </span>
                </button>
                <button
                    aria-label={`Remove Label ${index + 1}`}
                    className="remove-label-icon-button"
                    type="button"
                    onClick={() => onRemoveItem(item.id)}
                    disabled={isDisabled}
                >
                    <span className="remove-label-icon" aria-hidden="true" />
                </button>
            </div>

            <div
                aria-hidden={!isExpanded}
                className={isExpanded ? "batch-accordion-panel expanded-accordion-panel" : "batch-accordion-panel"}
                inert={isExpanded ? undefined : ""}
            >
                <div className="batch-accordion-panel-inner">
                    <div className="batch-accordion-body">
                        <div className="expanded-image-section">
                            <button
                                aria-label={item.image ? `Remove image for Label ${index + 1}` : `Add image for Label ${index + 1}`}
                                className={item.image ? "expanded-image-control has-image-preview" : "expanded-image-control empty-image-preview"}
                                type="button"
                                title={item.image ? undefined : "Select image file"}
                                onClick={handleImageControlClick}
                                disabled={isDisabled}
                            >
                                {item.image ? (
                                    <>
                                        <ImagePreview image={item.image} />
                                        <span className="preview-remove-overlay">Remove</span>
                                    </>
                                ) : (
                                    <span className="preview-add-icon" aria-hidden="true" />
                                )}
                            </button>
                            <div className="expanded-image-meta">
                                <span className="upload-label">Label Image</span>
                                <TileFileName fileName={item.image?.name || ""} />
                            </div>
                        </div>

                        <FieldGrid
                            formValues={item.values}
                            idPrefix={`batch-${item.id}`}
                            isDisabled={isDisabled}
                            onFieldChange={(fieldKey, value) => onFieldChange(item.id, fieldKey, value)}
                        />

                        <div className="next-incomplete-actions">
                            <button
                                className={isComplete ? "next-incomplete-button next-incomplete-button-ready" : "next-incomplete-button"}
                                type="button"
                                onClick={handleNextIncompleteClick}
                                disabled={isDisabled}
                            >
                                {shouldShowFinish ? "Finish" : "Next Incomplete"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <input
                ref={imageInputRef}
                className="hidden-file-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleChangeImage}
                disabled={isDisabled}
                tabIndex={-1}
            />
        </article>
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

function BatchResultsView({ result }) {
    const [openItemIndex, setOpenItemIndex] = useState(null);
    const resultItemRefs = useRef({});

    function toggleResultItem(itemIndex) {
        setOpenItemIndex((currentIndex) => {
            const shouldScrollToLowerItem = currentIndex !== null && itemIndex > currentIndex;
            if (shouldScrollToLowerItem) {
                window.setTimeout(() => {
                    const resultElement = resultItemRefs.current[itemIndex];
                    if (resultElement) {
                        scrollTileToViewportOffset(resultElement, 20);
                    }
                }, 240);
            }

            return currentIndex === itemIndex ? null : itemIndex;
        });
    }

    function registerResultItemRef(itemIndex, element) {
        if (element) {
            resultItemRefs.current[itemIndex] = element;
            return;
        }

        delete resultItemRefs.current[itemIndex];
    }

    return (
        <section className="results-panel" aria-labelledby="batch-results-title">
            <h2 id="batch-results-title" className="section-title">Batch Results</h2>
            <div className="summary-grid">
                <SummaryCard label="Passed" value={result.summary.passed} tone="passed" />
                <SummaryCard label="Needs Review" value={result.summary.needs_review} tone="review" />
                <SummaryCard label="Total" value={result.summary.total} tone="total" />
            </div>

            <div className="batch-results-list">
                {result.items.map((item) => (
                    <BatchResultItem
                        isOpen={item.index === openItemIndex}
                        item={item}
                        key={item.index}
                        onToggle={toggleResultItem}
                        registerResultItemRef={registerResultItemRef}
                    />
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

function BatchResultItem({ isOpen, item, onToggle, registerResultItemRef }) {
    const verification = item.verification;
    const isApproved = verification?.overall_verdict === "APPROVED";
    const title = `Label ${item.index + 1}: ${item.filename}`;

    function handleHeaderClick() {
        onToggle(item.index);
    }

    function handleHeaderKeyDown(event) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle(item.index);
        }
    }

    return (
        <article
            className={isOpen ? "batch-result-item is-open" : "batch-result-item"}
            ref={(element) => registerResultItemRef(item.index, element)}
        >
            <div
                className="batch-result-summary"
                onClick={handleHeaderClick}
                onKeyDown={handleHeaderKeyDown}
                role="button"
                tabIndex={0}
            >
                <span className="accordion-title">
                    {title}
                    <span className="accordion-arrow" aria-hidden="true" />
                </span>
                <strong className={item.status === "FAILED" ? "item-failed" : isApproved ? "item-approved" : "item-review"}>
                    {item.status === "FAILED" ? "Failed" : isApproved ? "Approved" : "Needs Review"}
                </strong>
            </div>
            <div
                aria-hidden={!isOpen}
                className={isOpen ? "batch-result-panel expanded-result-panel" : "batch-result-panel"}
                inert={isOpen ? undefined : ""}
            >
                <div className="batch-result-panel-inner">
                    {item.status === "FAILED" ? (
                        <div className="message message-error">{item.error}</div>
                    ) : (
                        <>
                            <p className="batch-time">
                                Completed in {formatSeconds(verification.latency_ms)} seconds
                            </p>
                            <ResultFields results={verification.results} />
                        </>
                    )}
                </div>
            </div>
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

function isBatchItemComplete(item) {
    return Boolean(item.image) && requiredFieldsComplete(item.values);
}

function getBatchAccordionItemClassName({ isComplete, isExpanded, shouldFlashIncomplete }) {
    const classNames = ["batch-accordion-item"];
    if (isExpanded) {
        classNames.push("expanded-batch-item");
    }
    if (shouldFlashIncomplete && !isExpanded && !isComplete) {
        classNames.push("flash-incomplete-label");
    }

    return classNames.join(" ");
}

function getNextIncompleteItemId(items, currentItemId) {
    const currentIndex = items.findIndex((item) => item.id === currentItemId);
    if (currentIndex === -1) {
        return items.find((item) => !isBatchItemComplete(item))?.id || null;
    }

    const nextIncompleteItem = items
        .slice(currentIndex + 1)
        .find((item) => !isBatchItemComplete(item));
    if (nextIncompleteItem) {
        return nextIncompleteItem.id;
    }

    return items.find((item) => !isBatchItemComplete(item))?.id || null;
}

function scrollTileToViewportOffset(element, topOffset) {
    element.style.scrollMarginTop = `${topOffset}px`;
    element.scrollIntoView({
        behavior: "smooth",
        block: "start",
    });
}

function scrollElementBottomToViewportBottom(element) {
    const targetTop = element.getBoundingClientRect().bottom + window.scrollY - window.innerHeight;
    window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth",
    });
}

function scrollToPageBottomIfScrollable() {
    const maxScrollTop = document.documentElement.scrollHeight - window.innerHeight;
    if (maxScrollTop <= 0) {
        return;
    }

    window.scrollTo({
        top: maxScrollTop,
        behavior: "smooth",
    });
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
