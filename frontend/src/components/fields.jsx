// Shared seven-field application form definition used by single and batch modes.
export const FIELD_DEFINITIONS = [
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

export const FIELD_LABELS = FIELD_DEFINITIONS.reduce((labels, field) => {
    labels[field.key] = field.label;
    return labels;
}, {});

export const INITIAL_FORM_VALUES = FIELD_DEFINITIONS.reduce((values, field) => {
    values[field.key] = "";
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
                {field.optional ? <span className="label-note">Optional if not on label</span> : null}
            </label>
            {field.multiline ? (
                <textarea
                    className={inputClassName}
                    id={inputId}
                    value={value}
                    onChange={(event) => onFieldChange(field.key, event.target.value)}
                    disabled={isDisabled}
                    rows={5}
                />
            ) : (
                <input
                    className={inputClassName}
                    id={inputId}
                    type="text"
                    value={value}
                    onChange={(event) => onFieldChange(field.key, event.target.value)}
                    disabled={isDisabled}
                />
            )}
        </div>
    );
}
