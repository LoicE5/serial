import { describe, expect, it } from "vitest";
import { CONTENT_STATUS_FILTERS } from "~/lib/content-status";
import { selectFeedItemOrderCoordinate } from "~/lib/data/feed-items/orderCoordinate";

describe("Feed-item order coordinate", () => {
  const postedAt = new Date("2026-08-17T12:00:00.000Z");
  const savedAt = new Date("2026-08-17T13:00:00.000Z");
  const archivedAt = new Date("2026-08-17T14:00:00.000Z");

  it("selects one coordinate for every content-status cell", () => {
    expect(
      CONTENT_STATUS_FILTERS.map((contentStatus) =>
        selectFeedItemOrderCoordinate(contentStatus, {
          postedAt,
          isWatchLaterUpdatedAt: savedAt,
          isWatchedUpdatedAt: archivedAt,
        }),
      ),
    ).toEqual([postedAt, archivedAt, savedAt, archivedAt]);
  });

  it("falls back to publication time when a transition timestamp is absent", () => {
    expect(
      CONTENT_STATUS_FILTERS.map((contentStatus) =>
        selectFeedItemOrderCoordinate(contentStatus, {
          postedAt,
          isWatchLaterUpdatedAt: null,
          isWatchedUpdatedAt: null,
        }),
      ),
    ).toEqual([postedAt, postedAt, postedAt, postedAt]);
  });
});
