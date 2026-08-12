import type {
  FeedItemFilterIndex,
  FeedItemListProjection,
} from "./data/feed-items/listProjection";
import type { ApplicationViewSection } from "~/server/db/schema";
import { VIEW_LAYOUT_ITEM_TYPE } from "~/server/db/constants";
import { compareDescendingIds } from "~/lib/sortOrder";

type SavedOrderCoordinate = {
  isWatchLaterUpdatedAt?: Date | string | null;
  postedAt: Date | string;
  id: string;
};

function dateValue(date: Date | string) {
  return date instanceof Date ? date.getTime() : new Date(date).getTime();
}

export function compareSavedOrderCoordinates(
  left: SavedOrderCoordinate,
  right: SavedOrderCoordinate,
) {
  const leftSavedAt = left.isWatchLaterUpdatedAt
    ? dateValue(left.isWatchLaterUpdatedAt)
    : dateValue(left.postedAt);
  const rightSavedAt = right.isWatchLaterUpdatedAt
    ? dateValue(right.isWatchLaterUpdatedAt)
    : dateValue(right.postedAt);
  if (leftSavedAt !== rightSavedAt) return rightSavedAt - leftSavedAt;

  const leftPostedAt = dateValue(left.postedAt);
  const rightPostedAt = dateValue(right.postedAt);
  if (leftPostedAt !== rightPostedAt) return rightPostedAt - leftPostedAt;

  return compareDescendingIds(left.id, right.id);
}

function getItemPlacement(
  feedId: number,
  viewSections: ApplicationViewSection[],
  filterIndex: FeedItemFilterIndex,
): number {
  let minFeedPlacement = Infinity;
  let minTagPlacement = Infinity;

  for (const section of viewSections) {
    if (section.itemType === VIEW_LAYOUT_ITEM_TYPE.FEED) {
      if (section.itemId === feedId) {
        minFeedPlacement = Math.min(minFeedPlacement, section.placement);
      }
    } else if (
      section.itemType === VIEW_LAYOUT_ITEM_TYPE.TAG &&
      filterIndex.categoryIdsByFeedId.get(feedId)?.has(section.itemId)
    ) {
      minTagPlacement = Math.min(minTagPlacement, section.placement);
    }
  }

  if (minFeedPlacement !== Infinity) {
    return minFeedPlacement;
  }

  return minTagPlacement === Infinity ? 999999 : minTagPlacement;
}

export function sortFeedItemsOrderByDate(
  feedItems: Record<string, FeedItemListProjection>,
) {
  return function (a: string, b: string) {
    const itemA = feedItems[a];
    const itemB = feedItems[b];

    if (!itemA || !itemB) return 0;

    const timeA =
      itemA.postedAt instanceof Date
        ? itemA.postedAt.getTime()
        : new Date(itemA.postedAt).getTime();
    const timeB =
      itemB.postedAt instanceof Date
        ? itemB.postedAt.getTime()
        : new Date(itemB.postedAt).getTime();

    if (timeB !== timeA) {
      return timeB - timeA;
    }

    return compareDescendingIds(itemA.id, itemB.id);
  };
}

export function sortFeedItemsOrderBySavedAt(
  feedItems: Record<string, FeedItemListProjection>,
) {
  return function (a: string, b: string) {
    const itemA = feedItems[a];
    const itemB = feedItems[b];

    if (!itemA || !itemB) return 0;
    return compareSavedOrderCoordinates(itemA, itemB);
  };
}

export function sortFeedItemsOrderByWatchedAt(
  feedItems: Record<string, FeedItemListProjection>,
) {
  return function (a: string, b: string) {
    const itemA = feedItems[a];
    const itemB = feedItems[b];

    if (!itemA || !itemB) return 0;

    const watchedTimeA = itemA.isWatchedUpdatedAt
      ? itemA.isWatchedUpdatedAt instanceof Date
        ? itemA.isWatchedUpdatedAt.getTime()
        : new Date(itemA.isWatchedUpdatedAt).getTime()
      : dateValue(itemA.postedAt);
    const watchedTimeB = itemB.isWatchedUpdatedAt
      ? itemB.isWatchedUpdatedAt instanceof Date
        ? itemB.isWatchedUpdatedAt.getTime()
        : new Date(itemB.isWatchedUpdatedAt).getTime()
      : dateValue(itemB.postedAt);

    if (watchedTimeB !== watchedTimeA) {
      return watchedTimeB - watchedTimeA;
    }

    return compareDescendingIds(itemA.id, itemB.id);
  };
}

export function sortFeedItemsOrderBySectionThenDate(
  feedItems: Record<string, FeedItemListProjection>,
  viewSections: ApplicationViewSection[],
  filterIndex: FeedItemFilterIndex,
) {
  return function (a: string, b: string) {
    const itemA = feedItems[a];
    const itemB = feedItems[b];

    if (!itemA || !itemB) return 0;

    const placementA = getItemPlacement(
      itemA.feedId,
      viewSections,
      filterIndex,
    );
    const placementB = getItemPlacement(
      itemB.feedId,
      viewSections,
      filterIndex,
    );

    if (placementA !== placementB) {
      return placementA - placementB;
    }

    const timeA =
      itemA.postedAt instanceof Date
        ? itemA.postedAt.getTime()
        : new Date(itemA.postedAt).getTime();
    const timeB =
      itemB.postedAt instanceof Date
        ? itemB.postedAt.getTime()
        : new Date(itemB.postedAt).getTime();

    if (timeB !== timeA) {
      return timeB - timeA;
    }

    return compareDescendingIds(itemA.id, itemB.id);
  };
}

export function sortFeedItemsOrderBySectionThenSavedAt(
  feedItems: Record<string, FeedItemListProjection>,
  viewSections: ApplicationViewSection[],
  filterIndex: FeedItemFilterIndex,
) {
  return function (a: string, b: string) {
    const itemA = feedItems[a];
    const itemB = feedItems[b];

    if (!itemA || !itemB) return 0;

    const placementA = getItemPlacement(
      itemA.feedId,
      viewSections,
      filterIndex,
    );
    const placementB = getItemPlacement(
      itemB.feedId,
      viewSections,
      filterIndex,
    );
    if (placementA !== placementB) return placementA - placementB;

    return compareSavedOrderCoordinates(itemA, itemB);
  };
}
