import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishBookmarkConsolidationDeletions } from "~/server/mixed-content/events";

const publisherMocks = vi.hoisted(() => ({
  publish: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/server/api/publisher", () => ({
  publisher: { publish: publisherMocks.publish },
}));

describe("Bookmark consolidation publication", () => {
  beforeEach(() => {
    publisherMocks.publish.mockClear();
  });

  it("publishes each removed Bookmark with independent invalidation authority", async () => {
    await publishBookmarkConsolidationDeletions({
      userId: "user-one",
      bookmarkIds: ["removed-one", "removed-two"],
      canonicalUrl: "https://example.com/article",
    });

    expect(publisherMocks.publish).toHaveBeenCalledTimes(2);
    expect(publisherMocks.publish.mock.calls).toEqual([
      [
        "user:user-one",
        {
          source: "bookmark",
          chunk: {
            type: "bookmark-delete",
            id: "removed-one",
            canonicalUrl: "https://example.com/article",
          },
          invalidation: {
            type: "reconciliation-invalidation",
            domains: ["navigation"],
            scopeImpact: { type: "unknown" },
          },
        },
      ],
      [
        "user:user-one",
        {
          source: "bookmark",
          chunk: {
            type: "bookmark-delete",
            id: "removed-two",
            canonicalUrl: "https://example.com/article",
          },
          invalidation: {
            type: "reconciliation-invalidation",
            domains: ["navigation"],
            scopeImpact: { type: "unknown" },
          },
        },
      ],
    ]);
  });
});
