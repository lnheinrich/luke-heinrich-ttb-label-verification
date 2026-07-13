import { useEffect, useRef, useState } from "react";
import { ResultFields, formatSeconds } from "./shared";
import { scrollTileToViewportOffset } from "../utils/scroll";

// Results that already received the post-verification focus scroll, so
// remounting the view (switching modes and back) does not re-scroll to them.
const focusedResults = new WeakSet();

export default function BatchResults({ result }) {
    const [openItemIndex, setOpenItemIndex] = useState(null);
    const resultItemRefs = useRef({});
    const headingRef = useRef(null);

    // Move focus to the results heading once per new batch result so the
    // outcome is visible without hunting below the fold.
    useEffect(() => {
        if (!headingRef.current || focusedResults.has(result)) {
            return;
        }

        focusedResults.add(result);
        headingRef.current.focus({ preventScroll: true });
        headingRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }, [result]);

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
            <h2 id="batch-results-title" className="section-title" ref={headingRef} tabIndex={-1}>Batch Results</h2>
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

    return (
        <article
            className={isOpen ? "batch-result-item is-open" : "batch-result-item"}
            ref={(element) => registerResultItemRef(item.index, element)}
        >
            <button
                aria-expanded={isOpen}
                className="batch-result-summary"
                type="button"
                onClick={handleHeaderClick}
            >
                <span className="accordion-title">
                    {title}
                    <span className="accordion-arrow" aria-hidden="true" />
                </span>
                <strong className={item.status === "FAILED" ? "item-failed" : isApproved ? "item-approved" : "item-review"}>
                    {item.status === "FAILED" ? "Failed" : isApproved ? "Approved" : "Needs Review"}
                </strong>
            </button>
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
