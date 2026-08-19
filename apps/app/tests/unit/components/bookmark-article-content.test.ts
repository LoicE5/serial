// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://serial.test/" }

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookmarkArticleContent } from "~/components/bookmarks/BookmarkArticleContent";

vi.mock("~/lib/hooks/useFlagState", () => ({
  useFlagState: () => ["iframe", () => undefined],
}));
vi.mock("~/components/CustomVideoPlayer", () => ({
  CustomVideoPlayer: () => null,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Bookmark article content", () => {
  it("renders the Page capture without waiting for another animation frame", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => {
      root.render(
        createElement(BookmarkArticleContent, {
          content: "<p>Captured article body</p>",
        }),
      );
    });

    expect(container.textContent).toBe("Captured article body");
    expect(container.querySelector("[data-reader-content-pending]")).toBeNull();
    act(() => root.unmount());
  });
});
