import { useEffect, useState } from "react";
import { FIELD_DEFINITIONS, INITIAL_FORM_VALUES, requiredFieldsComplete } from "../components/fields";

// Mirrors the backend MAX_BATCH_SIZE cap enforced on /verify/batch.
export const MAX_BATCH_ITEMS = 10;

// Create one batch label entry with a stable identity for list operations.
export function createBatchItem(image = null) {
    return {
        id: crypto.randomUUID(),
        image,
        values: { ...INITIAL_FORM_VALUES },
    };
}

export function isBatchItemComplete(item) {
    return Boolean(item.image) && requiredFieldsComplete(item.values);
}

export function getIncompleteBatchLabelNumbers(items) {
    return items.reduce((labelNumbers, item, index) => {
        if (!isBatchItemComplete(item)) {
            labelNumbers.push(index + 1);
        }
        return labelNumbers;
    }, []);
}

// Own the batch label list and every per-card mutation (fields, images, add/remove).
export default function useBatchItems({ onDuplicateImages, onLimitReached }) {
    const [items, setItems] = useState(() => [createBatchItem()]);
    const [activeItemId, setActiveItemId] = useState(null);

    useEffect(() => {
        if (activeItemId && !items.some((item) => item.id === activeItemId)) {
            setActiveItemId(null);
        }
    }, [activeItemId, items]);

    function updateField(itemId, fieldKey, value) {
        setItems((currentItems) =>
            currentItems.map((item) =>
                item.id === itemId
                    ? { ...item, values: { ...item.values, [fieldKey]: value } }
                    : item,
            ),
        );
    }

    function updateImage(itemId, image) {
        if (image) {
            const duplicateIndex = items.findIndex(
                (item) => item.id !== itemId && isSameFile(item.image, image),
            );
            if (duplicateIndex !== -1) {
                onDuplicateImages([duplicateIndex + 1]);
                return;
            }
        }

        setItems((currentItems) =>
            currentItems.map((item) => (item.id === itemId ? { ...item, image } : item)),
        );
    }

    function addImages(fileList) {
        const files = Array.from(fileList || []);
        if (files.length === 0) {
            return;
        }

        const nextItems = [...items];
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
            onDuplicateImages([...duplicateLabels]);
        }

        if (uniqueFiles.length === 0) {
            return;
        }

        if (nextItems.length === 1 && isBatchItemEmpty(nextItems[0])) {
            nextItems[0] = { ...nextItems[0], image: uniqueFiles[0] };
            fileIndex = 1;
        }

        while (fileIndex < uniqueFiles.length && nextItems.length < MAX_BATCH_ITEMS) {
            nextItems.push(createBatchItem(uniqueFiles[fileIndex]));
            fileIndex += 1;
        }

        if (fileIndex < uniqueFiles.length) {
            onLimitReached?.();
        }

        setItems(nextItems);
    }

    function addEmptyItem() {
        if (items.length >= MAX_BATCH_ITEMS) {
            onLimitReached?.();
            return;
        }

        setItems((currentItems) => [...currentItems, createBatchItem()]);
    }

    function removeItem(itemId) {
        const itemIndex = items.findIndex((item) => item.id === itemId);
        if (itemIndex === -1) {
            return;
        }

        if (items.length === 1) {
            setItems([createBatchItem()]);
            setActiveItemId(null);
            return;
        }

        setItems(items.filter((item) => item.id !== itemId));
        if (activeItemId === itemId) {
            setActiveItemId(null);
        }
    }

    return {
        activeItemId,
        addEmptyItem,
        addImages,
        items,
        removeItem,
        setActiveItemId,
        updateField,
        updateImage,
    };
}

// Untouched means no image and every field still holding its initial value;
// blank comparison would miss the prefilled government warning.
function isBatchItemEmpty(item) {
    return (
        !item.image &&
        FIELD_DEFINITIONS.every(
            (field) => item.values[field.key] === INITIAL_FORM_VALUES[field.key],
        )
    );
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
