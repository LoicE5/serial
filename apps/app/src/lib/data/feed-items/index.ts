import { useAtomValue } from "jotai";
import { useMemo } from "react";
import {
  categoryFilterAtom,
  contentStatusFilterAtom,
  feedFilterAtom,
  viewFilterAtom,
} from "../atoms";
import {
  feedItemsStore,
  getFeedItemScopeKey,
  useFeedItemsListProjection,
} from "../store";
import { useFeedCategories } from "../feed-categories/store";
import { useCustomViewsData, useViews } from "../views";
import { getMixedScopeKey, mixedContentStore } from "../mixed-content/store";
import { bookmarksStore } from "../bookmarks/store";
import { projectLocalMixedContentOrder } from "../mixed-content/bookmarkProjection";
import {
  createFeedItemFilterIndex,
  createFeedItemFilterPredicate,
  getItemSectionPlacement,
} from "./listProjection";
import type { ApplicationFeedItem, ApplicationView } from "~/server/db/schema";
import type { FeedItemFilterIndex } from "./listProjection";
import type { PaginationCursor } from "~/server/api/routers/initialRouter";
import type { ContentStatusFilter } from "~/lib/content-status";
import {
  buildContentStatusKey,
  contentStatusOrderDimension,
} from "~/lib/content-status";
import {
  compareSavedOrderCoordinates,
  sortFeedItemsOrderByDate,
  sortFeedItemsOrderBySavedAt,
  sortFeedItemsOrderBySectionThenDate,
  sortFeedItemsOrderBySectionThenSavedAt,
  sortFeedItemsOrderByWatchedAt,
} from "~/lib/sortFeedItems";

export { isFeedCompatibleWithContentFilter } from "./filters";
export {
  createFeedItemFilterIndex,
  createFeedItemFilterPredicate,
  getItemSectionPlacement,
  hasFeedItemListProjectionChanged,
} from "./listProjection";
export { mergeFeedItem } from "./mergeFeedItem";

function isItemOlderThanCursor(
  item: ApplicationFeedItem,
  cursor: PaginationCursor,
  contentStatusFilter: ContentStatusFilter,
  sectionPlacement?: number,
): boolean {
  if (!cursor) return false;

  // Sectioned views are ordered by placement asc, then postedAt/id desc.
  if (cursor.placement !== undefined && sectionPlacement !== undefined) {
    if (sectionPlacement > cursor.placement) {
      return true;
    }
    if (sectionPlacement < cursor.placement) {
      return false;
    }
  }

  // Archived ordering takes precedence over save status.
  const orderDimension = contentStatusOrderDimension(contentStatusFilter);
  if (orderDimension === "archived") {
    const itemWatchedTime =
      item.isWatchedUpdatedAt?.getTime() ?? item.postedAt.getTime();
    const cursorWatchedTime =
      cursor.isWatchedUpdatedAt?.getTime() ?? cursor.postedAt.getTime();

    if (itemWatchedTime < cursorWatchedTime) {
      return true;
    }
    if (itemWatchedTime === cursorWatchedTime) {
      const itemTime = item.postedAt.getTime();
      const cursorTime = cursor.postedAt.getTime();

      if (itemTime < cursorTime) {
        return true;
      }
      if (itemTime === cursorTime && item.id < cursor.id) {
        return true;
      }
    }
    return false;
  }

  if (orderDimension === "saved") {
    return compareSavedOrderCoordinates(item, cursor) > 0;
  }

  const itemTime = item.postedAt.getTime();
  const cursorTime = cursor.postedAt.getTime();

  if (itemTime < cursorTime) {
    return true;
  }
  if (itemTime === cursorTime && item.id < cursor.id) {
    return true;
  }
  return false;
}

function getActiveFeedItemsSort({
  feedItemsDict,
  contentStatusFilter,
  feedFilter,
  categoryFilter,
  viewFilter,
  filterIndex,
}: {
  feedItemsDict: Record<string, ApplicationFeedItem>;
  contentStatusFilter: ContentStatusFilter;
  feedFilter: number;
  categoryFilter: number;
  viewFilter: ApplicationView | null;
  filterIndex: FeedItemFilterIndex;
}) {
  const orderDimension = contentStatusOrderDimension(contentStatusFilter);
  if (orderDimension === "archived") {
    return sortFeedItemsOrderByWatchedAt(feedItemsDict);
  }

  const isFeedOrCategoryScoped = feedFilter >= 0 || categoryFilter >= 0;
  if (isFeedOrCategoryScoped || !viewFilter?.viewSections?.length) {
    return orderDimension === "saved"
      ? sortFeedItemsOrderBySavedAt(feedItemsDict)
      : sortFeedItemsOrderByDate(feedItemsDict);
  }

  return orderDimension === "saved"
    ? sortFeedItemsOrderBySectionThenSavedAt(
        feedItemsDict,
        viewFilter.viewSections,
        filterIndex,
      )
    : sortFeedItemsOrderBySectionThenDate(
        feedItemsDict,
        viewFilter.viewSections,
        filterIndex,
      );
}

export const useFilteredFeedItemsOrder = () => {
  const contentStatusFilter = useAtomValue(contentStatusFilterAtom);
  const categoryFilter = useAtomValue(categoryFilterAtom);
  const feedItemsOrder = feedItemsStore.useFeedItemsOrder();
  const feedItemsProjection = useFeedItemsListProjection();
  const scopeFeedItemIds = feedItemsStore.useScopeFeedItemIds();
  const feedCategories = useFeedCategories();
  const feedFilter = useAtomValue(feedFilterAtom);
  const viewFilter = useAtomValue(viewFilterAtom);
  const { customViews } = useCustomViewsData();
  const filterIndex = useMemo(
    () =>
      createFeedItemFilterIndex(
        feedCategories,
        viewFilter && !customViews.some((view) => view.id === viewFilter.id)
          ? [...customViews, viewFilter]
          : customViews,
      ),
    [feedCategories, customViews, viewFilter],
  );

  // Get pagination states for cursor-based filtering
  const viewPaginationState = feedItemsStore.useViewPaginationState();
  const feedPaginationState = feedItemsStore.useFeedPaginationState();
  const categoryPaginationState = feedItemsStore.useCategoryPaginationState();
  const contentStatusKey = buildContentStatusKey(contentStatusFilter);

  // Determine active cursor based on filter priority: feed > category > view
  const activeCursor: PaginationCursor | undefined = (() => {
    if (feedFilter >= 0) {
      return feedPaginationState[feedFilter]?.[contentStatusKey]?.cursor;
    }
    if (categoryFilter >= 0) {
      return categoryPaginationState[categoryFilter]?.[contentStatusKey]
        ?.cursor;
    }
    if (viewFilter?.id) {
      return viewPaginationState[viewFilter.id]?.[contentStatusKey]?.cursor;
    }
    return undefined;
  })();

  const activeScopeKey: string | undefined = (() => {
    if (feedFilter >= 0) {
      return getFeedItemScopeKey("feed", feedFilter, contentStatusFilter);
    }
    if (categoryFilter >= 0) {
      return getFeedItemScopeKey(
        "category",
        categoryFilter,
        contentStatusFilter,
      );
    }
    if (viewFilter?.id) {
      return getFeedItemScopeKey("view", viewFilter.id, contentStatusFilter);
    }
    return undefined;
  })();
  const scopedFeedItemsOrder = activeScopeKey
    ? scopeFeedItemIds[activeScopeKey]
    : undefined;

  return useMemo(() => {
    const feedItemsDict = feedItemsProjection.getItems();
    const baseFeedItemsOrder = scopedFeedItemsOrder ?? feedItemsOrder;
    const shouldApplyCursorFilter = scopedFeedItemsOrder === undefined;
    const doesFeedItemPassFilters = createFeedItemFilterPredicate({
      contentStatusFilter,
      categoryFilter,
      feedFilter,
      viewFilter,
      filterIndex,
    });

    const filteredFeedItemsOrder = baseFeedItemsOrder.filter((id) => {
      const item = feedItemsDict[id];
      if (!item) return false;

      // Apply cursor filter - hide items older than cursor
      const itemSectionPlacement = getItemSectionPlacement(
        item,
        viewFilter,
        filterIndex,
      );

      if (
        shouldApplyCursorFilter &&
        activeCursor &&
        isItemOlderThanCursor(
          item,
          activeCursor,
          contentStatusFilter,
          itemSectionPlacement,
        )
      ) {
        return false;
      }

      return doesFeedItemPassFilters(item);
    });

    return filteredFeedItemsOrder.sort(
      getActiveFeedItemsSort({
        feedItemsDict,
        contentStatusFilter,
        feedFilter,
        categoryFilter,
        viewFilter,
        filterIndex,
      }),
    );
  }, [
    activeCursor,
    categoryFilter,
    feedFilter,
    feedItemsProjection,
    feedItemsOrder,
    filterIndex,
    scopedFeedItemsOrder,
    viewFilter,
    contentStatusFilter,
  ]);
};

export const useFilteredContentOrder = () => {
  const feedItemsOrder = useFilteredFeedItemsOrder();
  const feedItemsProjection = useFeedItemsListProjection();
  const feedCategories = useFeedCategories();
  const contentStatusFilter = useAtomValue(contentStatusFilterAtom);
  const categoryFilter = useAtomValue(categoryFilterAtom);
  const feedFilter = useAtomValue(feedFilterAtom);
  const viewFilter = useAtomValue(viewFilterAtom);
  const mixedScopes = mixedContentStore.useScopes();
  const { views } = useViews();
  const bookmarkRevision = bookmarksStore.useRevision();
  const bookmarks = useMemo(() => {
    void bookmarkRevision;
    return { ...bookmarksStore.getState().snapshot() };
  }, [bookmarkRevision]);

  return useMemo(() => {
    if (feedFilter >= 0) return feedItemsOrder;
    const scope =
      categoryFilter >= 0
        ? ({ type: "tag", tagId: categoryFilter } as const)
        : viewFilter
          ? ({ type: "view", viewId: viewFilter.id } as const)
          : null;
    if (!scope) return feedItemsOrder;
    const loadedScope =
      mixedScopes[getMixedScopeKey(scope, contentStatusFilter)];
    if (loadedScope) {
      return loadedScope.references.map((reference) => reference.entityId);
    }
    return projectLocalMixedContentOrder({
      feedItemIds: feedItemsOrder,
      feedItems: feedItemsProjection.getItems(),
      bookmarks,
      scope,
      views,
      contentStatus: contentStatusFilter,
      feedCategories,
    });
  }, [
    bookmarks,
    categoryFilter,
    feedFilter,
    feedItemsOrder,
    feedItemsProjection,
    feedCategories,
    mixedScopes,
    viewFilter,
    views,
    contentStatusFilter,
  ]);
};
