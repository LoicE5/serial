import { describe, expect, it } from "vitest";
import { arrangeArchivedViewSection } from "../../../src/components/feed/view-lists/archivedViewSection";
import { VIEW_LAYOUT } from "../../../src/server/db/constants";
import type { ContentStatusFilter } from "../../../src/lib/content-status";

const time = (minutes: number) =>
  new Date(`2026-08-12T12:${String(minutes).padStart(2, "0")}:00.000Z`);

describe("Archived View section arrangement", () => {
  for (const saveStatus of ["inbox", "saved"] as const) {
    it(`collapses and orders ${saveStatus} + archived as one View section`, () => {
      const contentStatusFilter = {
        saveStatus,
        archiveStatus: "archived",
      } satisfies ContentStatusFilter;

      expect(
        arrangeArchivedViewSection({
          contentStatusFilter,
          currentViewName: "Reading",
          filteredItemIds: [
            "feed-fallback",
            "tie-a",
            "bookmark-newest",
            "feed-watched",
            "tie-z",
          ],
          feedItemsById: {
            "feed-fallback": {
              isWatchedUpdatedAt: null,
              isWatchLaterUpdatedAt: null,
              postedAt: time(2),
            },
            "feed-watched": {
              isWatchedUpdatedAt: time(3),
              isWatchLaterUpdatedAt: null,
              postedAt: time(59),
            },
            "tie-a": {
              isWatchedUpdatedAt: time(1),
              isWatchLaterUpdatedAt: null,
              postedAt: time(58),
            },
          },
          bookmarksById: {
            "bookmark-newest": { readUpdatedAt: time(4) },
            "tie-z": { readUpdatedAt: time(1) },
          },
          baseLayout: VIEW_LAYOUT.LARGE_GRID,
        }),
      ).toEqual({
        name: "Reading",
        items: [
          "bookmark-newest",
          "feed-watched",
          "feed-fallback",
          "tie-z",
          "tie-a",
        ],
        layout: VIEW_LAYOUT.LARGE_GRID,
        startIndex: 0,
        isUncategorized: true,
        placement: null,
      });
    });
  }

  it.each([
    { saveStatus: "inbox", archiveStatus: "unread" },
    { saveStatus: "saved", archiveStatus: "unread" },
  ] satisfies ContentStatusFilter[])(
    "leaves configured sections intact for $saveStatus + unread",
    (contentStatusFilter) => {
      expect(
        arrangeArchivedViewSection({
          contentStatusFilter,
          currentViewName: "Reading",
          filteredItemIds: ["feed-item"],
          feedItemsById: {},
          bookmarksById: {},
          baseLayout: VIEW_LAYOUT.LIST,
        }),
      ).toBeUndefined();
    },
  );
});
