import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItemMeta } from "~/components/feed/view-lists/ItemDisplay";
import { getBookmarkPostedAt } from "~/components/feed/view-lists/itemDate";

const NOW = new Date("2026-08-19T12:00:00.000Z");

afterEach(() => vi.useRealTimers());

describe("ItemMeta", () => {
  it("shows one plain relative posted date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const markup = renderToStaticMarkup(
      createElement(ItemMeta, {
        author: "Ada Lovelace",
        feedName: "Example Feed",
        postedAt: new Date("2026-08-18T12:00:00.000Z"),
      }),
    );

    expect(markup).toContain("Ada Lovelace • 1 day ago");
    expect(markup).not.toMatch(/Posted|Read|Watched|Saved/);
  });

  it("uses a Bookmark publication date with a creation-date fallback", () => {
    const createdAt = new Date("2026-08-17T12:00:00.000Z");
    const publishedAt = new Date("2026-08-18T12:00:00.000Z");

    expect(getBookmarkPostedAt({ createdAt, publishedAt })).toBe(publishedAt);
    expect(getBookmarkPostedAt({ createdAt, publishedAt: null })).toBe(
      createdAt,
    );
  });
});
