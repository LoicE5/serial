import type { ViewSection } from "./useViewSections";
import type { ViewLayout } from "~/server/db/constants";
import type { ApplicationBookmark } from "~/server/mixed-content/projection";
import type { ContentStatusFilter } from "~/lib/content-status";
import type { FeedItemListProjection } from "~/lib/data/feed-items/listProjection";
import { contentStatusOrderDimension } from "~/lib/content-status";
import { selectFeedItemOrderCoordinate } from "~/lib/data/feed-items/orderCoordinate";
import { compareDescendingIds } from "~/lib/sortOrder";

type ArchivedFeedItem = Pick<
  FeedItemListProjection,
  "isWatchedUpdatedAt" | "isWatchLaterUpdatedAt" | "postedAt"
>;

type ArchivedBookmark = Pick<ApplicationBookmark, "readUpdatedAt">;

export function arrangeArchivedViewSection(input: {
  contentStatusFilter: ContentStatusFilter;
  currentViewName: string | undefined;
  filteredItemIds: string[];
  feedItemsById: Record<string, ArchivedFeedItem | undefined>;
  bookmarksById: Record<string, ArchivedBookmark | undefined>;
  baseLayout: ViewLayout;
}): ViewSection | undefined {
  if (contentStatusOrderDimension(input.contentStatusFilter) !== "archived") {
    return undefined;
  }

  const items = [...input.filteredItemIds].sort((leftId, rightId) => {
    const leftFeedItem = input.feedItemsById[leftId];
    const rightFeedItem = input.feedItemsById[rightId];
    const leftArchivedAt =
      input.bookmarksById[leftId]?.readUpdatedAt.getTime() ??
      (leftFeedItem
        ? selectFeedItemOrderCoordinate(
            input.contentStatusFilter,
            leftFeedItem,
          ).getTime()
        : undefined) ??
      0;
    const rightArchivedAt =
      input.bookmarksById[rightId]?.readUpdatedAt.getTime() ??
      (rightFeedItem
        ? selectFeedItemOrderCoordinate(
            input.contentStatusFilter,
            rightFeedItem,
          ).getTime()
        : undefined) ??
      0;

    if (leftArchivedAt !== rightArchivedAt) {
      return rightArchivedAt - leftArchivedAt;
    }
    return compareDescendingIds(leftId, rightId);
  });

  return {
    name: input.currentViewName ?? "View",
    items,
    layout: input.baseLayout,
    startIndex: 0,
    isUncategorized: true,
    placement: null,
  };
}
