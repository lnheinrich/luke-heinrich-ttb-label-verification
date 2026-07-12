import { useEffect, useRef, useState } from "react";
import { FIELD_LABELS } from "./fields";

export function FormMessages({ error, isLoading, loadingText }) {
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

export function TileFileName({ fileName }) {
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

export function ImagePreview({ image }) {
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

export function ResultFields({ results }) {
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

function displayValue(value) {
    return value || "Not found on label";
}

export function formatSeconds(latencyMs) {
    return (latencyMs / 1000).toFixed(1);
}
