import { useState } from "react";

// Standard TTB health warning statement mandated on every label (27 CFR 16.21).
export const STANDARD_GOVERNMENT_WARNING =
    "GOVERNMENT WARNING: (1) ACCORDING TO THE SURGEON GENERAL, WOMEN SHOULD " +
    "NOT DRINK ALCOHOLIC BEVERAGES DURING PREGNANCY BECAUSE OF THE RISK OF " +
    "BIRTH DEFECTS. (2) CONSUMPTION OF ALCOHOLIC BEVERAGES IMPAIRS YOUR " +
    "ABILITY TO DRIVE A CAR OR OPERATE MACHINERY, AND MAY CAUSE HEALTH " +
    "PROBLEMS.";

export const NET_CONTENTS_UNITS = ["mL", "cL", "L", "fl oz"];

// Shared seven-field application form definition used by single and batch modes.
export const FIELD_DEFINITIONS = [
    { key: "brand_name", label: "Brand Name" },
    { key: "class_type", label: "Class / Type" },
    { key: "abv", label: "Alcohol Content", hint: "%", kind: "number" },
    { key: "net_contents", label: "Bottle Size", kind: "measure", units: NET_CONTENTS_UNITS },
    { key: "producer", label: "Producer" },
    { key: "country_of_origin", label: "Country of Origin" },
    {
        key: "government_warning",
        label: "Government Warning",
        multiline: true,
        note: "Prefilled with the standard warning. Edit only if your application differs.",
        defaultValue: STANDARD_GOVERNMENT_WARNING,
    },
];

export const FIELD_LABELS = FIELD_DEFINITIONS.reduce((labels, field) => {
    labels[field.key] = field.label;
    return labels;
}, {});

export const INITIAL_FORM_VALUES = FIELD_DEFINITIONS.reduce((values, field) => {
    values[field.key] = field.defaultValue || "";
    return values;
}, {});

export function requiredFieldsComplete(values) {
    return FIELD_DEFINITIONS.every(
        (field) => field.optional || values[field.key].trim(),
    );
}

export function FieldGrid({ flashMissingInputs = false, formValues, idPrefix, isDisabled, onFieldChange }) {
    return (
        <div className="field-grid">
            {FIELD_DEFINITIONS.map((field) => (
                <FieldRow
                    field={field}
                    inputId={`${idPrefix}-${field.key}`}
                    isDisabled={isDisabled}
                    key={field.key}
                    onFieldChange={onFieldChange}
                    shouldFlash={flashMissingInputs && !field.optional && !formValues[field.key].trim()}
                    value={formValues[field.key]}
                />
            ))}
        </div>
    );
}

export function FieldRow({ field, inputId, isDisabled, onFieldChange, shouldFlash, value }) {
    const inputClassName = shouldFlash ? "missing-input-flash" : undefined;

    return (
        <div className={field.multiline ? "field-row field-wide" : "field-row"}>
            <label htmlFor={inputId}>
                {field.label}
                {field.hint ? <span className="inline-hint">({field.hint})</span> : null}
                {field.note ? <span className="label-note">{field.note}</span> : null}
            </label>
            <FieldInput
                className={inputClassName}
                field={field}
                inputId={inputId}
                isDisabled={isDisabled}
                onFieldChange={onFieldChange}
                value={value}
            />
        </div>
    );
}

function FieldInput({ className, field, inputId, isDisabled, onFieldChange, value }) {
    if (field.multiline) {
        return (
            <textarea
                className={className}
                id={inputId}
                value={value}
                onChange={(event) => onFieldChange(field.key, event.target.value)}
                disabled={isDisabled}
                rows={5}
            />
        );
    }

    if (field.kind === "number") {
        return (
            <input
                className={className}
                id={inputId}
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.1"
                value={value}
                onChange={(event) => onFieldChange(field.key, event.target.value)}
                disabled={isDisabled}
            />
        );
    }

    if (field.kind === "measure") {
        return (
            <MeasureInput
                className={className}
                field={field}
                inputId={inputId}
                isDisabled={isDisabled}
                onFieldChange={onFieldChange}
                value={value}
            />
        );
    }

    return (
        <input
            className={className}
            id={inputId}
            type="text"
            value={value}
            onChange={(event) => onFieldChange(field.key, event.target.value)}
            disabled={isDisabled}
        />
    );
}

// Numeric amount plus a unit selector, stored as one "750 mL" style string so
// the API payload keeps the same shape the backend parser expects.
function MeasureInput({ className, field, inputId, isDisabled, onFieldChange, value }) {
    const parsed = parseMeasureValue(value, field.units);
    const [pendingUnit, setPendingUnit] = useState(field.units[0]);
    const unit = parsed.unit || pendingUnit;

    function handleAmountChange(event) {
        const amount = event.target.value;
        onFieldChange(field.key, amount ? `${amount} ${unit}` : "");
    }

    function handleUnitChange(event) {
        const nextUnit = event.target.value;
        setPendingUnit(nextUnit);
        if (parsed.amount) {
            onFieldChange(field.key, `${parsed.amount} ${nextUnit}`);
        }
    }

    return (
        <div className="measure-input-row">
            <input
                className={className}
                id={inputId}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={parsed.amount}
                onChange={handleAmountChange}
                disabled={isDisabled}
            />
            <select
                aria-label={`${field.label} unit`}
                className="measure-unit-select"
                value={unit}
                onChange={handleUnitChange}
                disabled={isDisabled}
            >
                {field.units.map((unitOption) => (
                    <option key={unitOption} value={unitOption}>
                        {unitOption}
                    </option>
                ))}
            </select>
        </div>
    );
}

function parseMeasureValue(value, units) {
    const match = /^\s*(\d*\.?\d*)\s*(.*)$/.exec(value || "");
    const amount = match ? match[1] : "";
    const unitText = match ? match[2].trim().toLowerCase() : "";
    const unit = units.find((candidate) => candidate.toLowerCase() === unitText) || "";

    return { amount, unit };
}
