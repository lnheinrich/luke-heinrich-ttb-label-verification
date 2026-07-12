import { useRef } from "react";
import BatchResults from "./BatchResults";
import { FieldGrid } from "./fields";
import { FormMessages, ImagePreview, TileFileName } from "./shared";
import { MAX_BATCH_ITEMS, isBatchItemComplete } from "../hooks/useBatchItems";
import {
    scrollElementBottomToViewportBottom,
    scrollTileToViewportOffset,
    scrollToPageBottomIfScrollable,
} from "../utils/scroll";

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

            {result && <BatchResults result={result} />}
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
    const isAtCapacity = items.length >= MAX_BATCH_ITEMS;

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
                        className={isAtCapacity && !isDisabled ? "secondary-button at-capacity" : "secondary-button"}
                        type="button"
                        onClick={openAddImagesPicker}
                        disabled={isDisabled || isAtCapacity}
                        title={
                            isAtCapacity
                                ? `Batch is limited to ${MAX_BATCH_ITEMS} labels.`
                                : "Select one or more images to generate label entries."
                        }
                    >
                        Add Images
                    </button>
                    <span>{items.length}/{MAX_BATCH_ITEMS} labels</span>
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
                    className={isAtCapacity && !isDisabled ? "add-empty-label-button at-capacity" : "add-empty-label-button"}
                    type="button"
                    onClick={onAddEmptyLabel}
                    disabled={isDisabled || isAtCapacity}
                    title={isAtCapacity ? `Batch is limited to ${MAX_BATCH_ITEMS} labels.` : undefined}
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
