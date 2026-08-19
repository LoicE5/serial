"use client";

import { useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import {
  categoryFilterAtom,
  contentStatusFilterAtom,
  feedFilterAtom,
  viewFilterAtom,
} from "~/lib/data/atoms";
import {
  getMixedScopeKey,
  mixedContentStore,
} from "~/lib/data/mixed-content/store";
import { dataRequestActions } from "~/lib/data/directRequests";

export function useLoadMoreItems() {
  const feedFilter = useAtomValue(feedFilterAtom);
  const categoryFilter = useAtomValue(categoryFilterAtom);
  const currentView = useAtomValue(viewFilterAtom);
  const contentStatusFilter = useAtomValue(contentStatusFilterAtom);
  const mixedScopes = mixedContentStore.useScopes();
  const fetchingMixedScopes = mixedContentStore.useFetchingScopes();

  const mixedScope = useMemo(
    () =>
      feedFilter >= 0
        ? ({ type: "feed", feedId: feedFilter } as const)
        : categoryFilter >= 0
          ? ({ type: "tag", tagId: categoryFilter } as const)
          : currentView
            ? ({ type: "view", viewId: currentView.id } as const)
            : null,
    [categoryFilter, currentView, feedFilter],
  );
  const mixedScopeKey = mixedScope
    ? getMixedScopeKey(mixedScope, contentStatusFilter)
    : null;
  const paginationState = mixedScopeKey
    ? mixedScopes[mixedScopeKey]
    : undefined;

  const requestMixedPage = useCallback(
    async (resetCursor: boolean) => {
      if (!mixedScope || !mixedScopeKey) return;
      if (mixedContentStore.getState().fetchingScopes[mixedScopeKey]) return;
      mixedContentStore.getState().setScopeFetching(mixedScopeKey, true);
      try {
        const existingScope =
          mixedContentStore.getState().scopes[mixedScopeKey];
        await dataRequestActions.requestMixedContentPage(
          mixedScope,
          contentStatusFilter,
          resetCursor ? null : existingScope?.cursor,
        );
      } finally {
        mixedContentStore.getState().setScopeFetching(mixedScopeKey, false);
      }
    },
    [contentStatusFilter, mixedScope, mixedScopeKey],
  );

  return {
    handleLoadMore: () => requestMixedPage(false),
    handleRefresh: () => requestMixedPage(true),
    paginationKey: mixedScopeKey ?? "none",
    paginationState: paginationState
      ? {
          cursor: paginationState.cursor,
          hasMore: paginationState.hasMore,
          isFetching: mixedScopeKey
            ? (fetchingMixedScopes[mixedScopeKey] ?? false)
            : false,
          isLoaded: true,
        }
      : {
          cursor: null,
          hasMore: mixedScope !== null,
          isFetching: mixedScopeKey
            ? (fetchingMixedScopes[mixedScopeKey] ?? false)
            : false,
          isLoaded: false,
        },
  };
}
