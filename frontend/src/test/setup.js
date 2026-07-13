import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom does not implement layout or object URLs, both of which the app
// touches (result-focus scrolling and image previews).
Element.prototype.scrollIntoView = vi.fn();
window.scrollTo = vi.fn();
window.scrollBy = vi.fn();
URL.createObjectURL = vi.fn(() => "blob:test-preview");
URL.revokeObjectURL = vi.fn();

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});
