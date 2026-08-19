import { useAtomValue } from "jotai";
import { useMemo } from "react";
import {
  categoryFilterAtom,
  contentStatusFilterAtom,
  feedFilterAtom,
  viewFilterAtom,
} from "../atoms";
import { feedItemsStore, useFeedItemsListProjection } from "../store";
import { useFeedCategories } from "../feed-categories/store";
import { useCustomViewsData, useViews } from "../views";
import { getMixedScopeKey, mixedContentStore } from "../mixed-content/store";
import { bookmarksStore } from "../bookmarks/store";
import { projectLocalMixedContentOrder } from "../mixed-content/bookmarkProjection";
import {
  createFeedItemFilterIndex,
  createFeedItemFilterPredicate,
} from "./listProjection";
import type { ApplicationFeedItem, ApplicationView } from "~/server/db/schema";
import type { FeedItemFilterIndex } from "./listProjection";
import type { ContentStatusFilter } from "~/lib/content-status";
import { contentStatusOrderDimension } from "~/lib/content-status";
import {
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

  return useMemo(() => {
    const feedItemsDict = feedItemsProjection.getItems();
    const doesFeedItemPassFilters = createFeedItemFilterPredicate({
      contentStatusFilter,
      categoryFilter,
      feedFilter,
      viewFilter,
      filterIndex,
    });

    const filteredFeedItemsOrder = feedItemsOrder.filter((id) => {
      const item = feedItemsDict[id];
      if (!item) return false;

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
    categoryFilter,
    feedFilter,
    feedItemsProjection,
    feedItemsOrder,
    filterIndex,
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
    const scope =
      feedFilter >= 0
        ? ({ type: "feed", feedId: feedFilter } as const)
        : categoryFilter >= 0
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
