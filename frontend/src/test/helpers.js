import { vi } from "vitest";

// Capture outgoing /verify requests while returning a minimal successful
// response so the app can finish its submit flow.
export function stubFetch(responseBody) {
    const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => responseBody,
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

export function makeImageFile(name) {
    return new File(["stub-image-bytes"], name, { type: "image/png" });
}

export const SINGLE_VERIFY_RESPONSE = {
    overall_verdict: "APPROVED",
    results: [],
    latency_ms: 12,
};

export const BATCH_VERIFY_RESPONSE = {
    items: [],
    summary: { passed: 0, needs_review: 0, total: 0 },
};
