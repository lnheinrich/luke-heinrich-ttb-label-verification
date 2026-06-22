import { useEffect, useRef, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

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
    const [shouldFlashSingleMissingInputs, setShouldFlashSingleMissingInputs] = useState(false);
    const singleMissingInputsFlashTimerRef = useRef(null);
    const [batchItems, setBatchItems] = useState(() => [createBatchItem()]);
    const [activeBatchItemId, setActiveBatchItemId] = useState(null);
    const [batchResult, setBatchResult] = useState(null);
    const [batchError, setBatchError] = useState("");
    const [isBatchVerifying, setIsBatchVerifying] = useState(false);
    const [showBatchProgress, setShowBatchProgress] = useState(false);
    const [duplicateImageAlert, setDuplicateImageAlert] = useState(null);
    const duplicateImageAlertTimerRef = useRef(null);
    const [incompleteLabelsAlert, setIncompleteLabelsAlert] = useState(null);
    const incompleteLabelsAlertTimerRef = useRef(null);
    const alertOrderRef = useRef(0);
    const [flashingIncompleteItemIds, setFlashingIncompleteItemIds] = useState([]);
    const incompleteLabelFlashTimerRef = useRef(null);

    useEffect(() => {
        if (activeBatchItemId && !batchItems.some((item) => item.id === activeBatchItemId)) {
            setActiveBatchItemId(null);
        }
    }, [activeBatchItemId, batchItems]);

    useEffect(() => {
        if (mode !== "batch") {
            window.clearTimeout(incompleteLabelFlashTimerRef.current);
            setFlashingIncompleteItemIds([]);
        }
    }, [mode]);

    useEffect(() => () => {
        window.clearTimeout(duplicateImageAlertTimerRef.current);
        window.clearTimeout(incompleteLabelsAlertTimerRef.current);
        window.clearTimeout(incompleteLabelFlashTimerRef.current);
        window.clearTimeout(singleMissingInputsFlashTimerRef.current);
    }, []);

    async function handleSingleSubmit(event) {
        event.preventDefault();
        setSingleError("");

        const validationError = validateLabelInput(singleImage, singleValues);
        if (validationError) {
            showSingleIncompleteAlert();
            flashSingleMissingInputs();
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

        const incompleteLabelNumbers = getIncompleteBatchLabelNumbers(batchItems);
        if (incompleteLabelNumbers.length > 0) {
            showIncompleteLabelsAlert(incompleteLabelNumbers);
            flashIncompleteLabels(batchItems);
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
        if (image) {
            const duplicateIndex = batchItems.findIndex(
                (item) => item.id !== itemId && isSameFile(item.image, image),
            );
            if (duplicateIndex !== -1) {
                showDuplicateImageAlert([duplicateIndex + 1]);
                return;
            }
        }

        setBatchItems((currentItems) =>
            currentItems.map((item) => (item.id === itemId ? { ...item, image } : item)),
        );
    }

    function addBatchImages(fileList) {
        const files = Array.from(fileList || []);
        if (files.length === 0) {
            return;
        }

        const nextItems = [...batchItems];
        const existingImageLabels = new Map();
        nextItems.forEach((item, index) => {
            const signature = getFileSignature(item.image);
            if (signature) {
                existingImageLabels.set(signature, index + 1);
            }
        });
        const selectedSignatures = new Set();
        const duplicateLabels = new Set();
        const uniqueFiles = files.filter((file) => {
            const signature = getFileSignature(file);
            const existingLabel = existingImageLabels.get(signature);
            if (existingLabel) {
                duplicateLabels.add(existingLabel);
                return false;
            }
            if (selectedSignatures.has(signature)) {
                return false;
            }
            selectedSignatures.add(signature);
            return true;
        });
        let fileIndex = 0;

        if (duplicateLabels.size > 0) {
            showDuplicateImageAlert([...duplicateLabels]);
        }

        if (uniqueFiles.length === 0) {
            return;
        }

        if (nextItems.length === 1 && isBatchItemEmpty(nextItems[0])) {
            nextItems[0] = { ...nextItems[0], image: uniqueFiles[0] };
            fileIndex = 1;
        }

        while (fileIndex < uniqueFiles.length) {
            nextItems.push(createBatchItem(uniqueFiles[fileIndex]));
            fileIndex += 1;
        }

        setBatchItems(nextItems);
    }

    function addEmptyBatchItem() {
        setBatchItems((currentItems) => [...currentItems, createBatchItem()]);
    }

    function removeBatchItem(itemId) {
        const itemIndex = batchItems.findIndex((item) => item.id === itemId);
        if (itemIndex === -1) {
            return;
        }

        if (batchItems.length === 1) {
            const emptyItem = createBatchItem();
            setBatchItems([emptyItem]);
            setActiveBatchItemId(null);
            return;
        }

        const nextItems = batchItems.filter((item) => item.id !== itemId);

        setBatchItems(nextItems);
        if (activeBatchItemId === itemId) {
            setActiveBatchItemId(null);
        }
    }

    function showDuplicateImageAlert(labelNumbers) {
        const sortedLabelNumbers = [...labelNumbers].sort((firstNumber, secondNumber) => firstNumber - secondNumber);
        const displayedLabelNumbers = sortedLabelNumbers.slice(0, 5);
        const message =
            sortedLabelNumbers.length === 1
                ? `Selected image already exists in Label ${sortedLabelNumbers[0]}`
                : sortedLabelNumbers.length > 5
                    ? `Selected images already exist in Labels ${displayedLabelNumbers.join(", ")}, and other Labels`
                    : `Selected images already exist in Labels ${sortedLabelNumbers.join(", ")}`;

        window.clearTimeout(duplicateImageAlertTimerRef.current);
        setDuplicateImageAlert({
            id: crypto.randomUUID(),
            message,
            order: getNextAlertOrder(),
        });
        duplicateImageAlertTimerRef.current = window.setTimeout(() => {
            setDuplicateImageAlert(null);
        }, 5400);
    }

    function showIncompleteLabelsAlert(labelNumbers) {
        window.clearTimeout(incompleteLabelsAlertTimerRef.current);
        setIncompleteLabelsAlert({
            id: crypto.randomUUID(),
            message: formatIncompleteLabelsMessage(labelNumbers),
            order: getNextAlertOrder(),
        });
        incompleteLabelsAlertTimerRef.current = window.setTimeout(() => {
            setIncompleteLabelsAlert(null);
        }, 5400);
    }

    function showSingleIncompleteAlert() {
        window.clearTimeout(incompleteLabelsAlertTimerRef.current);
        setIncompleteLabelsAlert({
            id: crypto.randomUUID(),
            message: "Label is incomplete",
            order: getNextAlertOrder(),
        });
        incompleteLabelsAlertTimerRef.current = window.setTimeout(() => {
            setIncompleteLabelsAlert(null);
        }, 5400);
    }

    function flashIncompleteLabels(items) {
        const incompleteItemIds = items
            .filter((item) => !isBatchItemComplete(item))
            .map((item) => item.id);

        window.clearTimeout(incompleteLabelFlashTimerRef.current);
        setFlashingIncompleteItemIds([]);
        window.requestAnimationFrame(() => {
            setFlashingIncompleteItemIds(incompleteItemIds);
        });
        incompleteLabelFlashTimerRef.current = window.setTimeout(() => {
            setFlashingIncompleteItemIds([]);
        }, 5400);
    }

    function flashSingleMissingInputs() {
        window.clearTimeout(singleMissingInputsFlashTimerRef.current);
        setShouldFlashSingleMissingInputs(false);
        window.requestAnimationFrame(() => {
            setShouldFlashSingleMissingInputs(true);
        });
        singleMissingInputsFlashTimerRef.current = window.setTimeout(() => {
            setShouldFlashSingleMissingInputs(false);
        }, 5400);
    }

    function getNextAlertOrder() {
        alertOrderRef.current += 1;
        return alertOrderRef.current;
    }

    const visibleAlerts = [
        duplicateImageAlert
            ? {
                className: "duplicate-image-alert",
                id: duplicateImageAlert.id,
                message: duplicateImageAlert.message,
                order: duplicateImageAlert.order,
                role: "status",
            }
            : null,
        incompleteLabelsAlert
            ? {
                className: "batch-incomplete-alert",
                id: incompleteLabelsAlert.id,
                message: incompleteLabelsAlert.message,
                order: incompleteLabelsAlert.order,
                role: "alert",
            }
            : null,
    ]
        .filter(Boolean)
        .sort((firstAlert, secondAlert) => firstAlert.order - secondAlert.order);

    return (
        <>
            {visibleAlerts.length > 0 ? (
                <div className="alert-stack">
                    {visibleAlerts.map((alert) => (
                        <div
                            className={alert.className}
                            key={alert.id}
                            role={alert.role}
                        >
                            {alert.message}
                        </div>
                    ))}
                </div>
            ) : null}

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
                            flashMissingInputs={shouldFlashSingleMissingInputs}
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
                            activeItemId={activeBatchItemId}
                            error={batchError}
                            flashingIncompleteItemIds={flashingIncompleteItemIds}
                            isVerifying={isBatchVerifying}
                            onActiveItemChange={setActiveBatchItemId}
                            onAddEmptyLabel={addEmptyBatchItem}
                            onAddImages={addBatchImages}
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
        </>
    );
}

function SingleLabelForm({
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

function BatchForm({
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

function FieldGrid({ flashMissingInputs = false, formValues, idPrefix, isDisabled, onFieldChange }) {
    return (
        <div className="field-grid">
            {FIELD_DEFINITIONS.map((field) => {
                const shouldFlashField = flashMissingInputs && !field.optional && !formValues[field.key].trim();
                const inputClassName = shouldFlashField ? "missing-input-flash" : undefined;

                return (
                    <div
                        className={field.multiline ? "field-row field-wide" : "field-row"}
                        key={field.key}
                    >
                        <label>
                            {field.label}
                            {field.hint ? <span className="inline-hint">({field.hint})</span> : null}
                            {field.optional ? <span className="label-note">Optional if not on label</span> : null}
                        </label>
                        {field.multiline ? (
                            <textarea
                                className={inputClassName}
                                id={`${idPrefix}-${field.key}`}
                                value={formValues[field.key]}
                                onChange={(event) => onFieldChange(field.key, event.target.value)}
                                disabled={isDisabled}
                                rows={5}
                            />
                        ) : (
                            <input
                                className={inputClassName}
                                id={`${idPrefix}-${field.key}`}
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
                <SummaryCard label="Failed" value={result.summary.failed} tone="failed" />
                <SummaryCard label="Total" value={result.summary.total} tone="total" />
            </div>
            <p className="batch-time">Completed in {formatSeconds(result.latency_ms)} seconds</p>

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

function createBatchItem(image = null) {
    return {
        id: crypto.randomUUID(),
        image,
        values: { ...INITIAL_FORM_VALUES },
    };
}

function isBatchItemComplete(item) {
    return Boolean(item.image) && requiredFieldsComplete(item.values);
}

function isSingleLabelComplete(image, values) {
    return Boolean(image) && requiredFieldsComplete(values);
}

function isBatchItemEmpty(item) {
    return !item.image && FIELD_DEFINITIONS.every((field) => !item.values[field.key].trim());
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

function getFileSignature(file) {
    if (!file) {
        return "";
    }

    return `${file.name}:${file.size}:${file.lastModified}`;
}

function isSameFile(firstFile, secondFile) {
    return Boolean(firstFile && secondFile && getFileSignature(firstFile) === getFileSignature(secondFile));
}

function getIncompleteBatchLabelNumbers(items) {
    return items.reduce((labelNumbers, item, index) => {
        if (!isBatchItemComplete(item)) {
            labelNumbers.push(index + 1);
        }
        return labelNumbers;
    }, []);
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

function formatIncompleteLabelsMessage(labelNumbers) {
    const sortedLabelNumbers = [...labelNumbers].sort((firstNumber, secondNumber) => firstNumber - secondNumber);
    const displayedLabelNumbers = sortedLabelNumbers.slice(0, 5);

    if (sortedLabelNumbers.length === 1) {
        return `Label ${sortedLabelNumbers[0]} is incomplete`;
    }

    if (sortedLabelNumbers.length > 5) {
        return `Labels ${displayedLabelNumbers.join(", ")}, and other Labels are incomplete`;
    }

    return `Labels ${sortedLabelNumbers.join(", ")} are incomplete`;
}

function validateLabelInput(image, values) {
    if (!image) {
        return "Choose a label image before verifying.";
    }

    if (!requiredFieldsComplete(values)) {
        return "Fill in all required fields before verifying.";
    }

    return "";
}

function requiredFieldsComplete(values) {
    return FIELD_DEFINITIONS.every(
        (field) => field.optional || values[field.key].trim(),
    );
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
