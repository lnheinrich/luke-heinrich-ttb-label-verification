import { useEffect, useRef, useState } from "react";
import Batch from "./components/Batch";
import Single from "./components/Single";

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
                        <Single
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
                        <Batch
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

function isBatchItemEmpty(item) {
    return !item.image && FIELD_DEFINITIONS.every((field) => !item.values[field.key].trim());
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
