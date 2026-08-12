"use client";

import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { contentStatusFilterAtom, feedFilterAtom } from "~/lib/data/atoms";
import { useFetchMoreItemsForFeed } from "~/lib/data/store";

/**
 * Hook that triggers lazy loading of items when a feed is selected.
 * Fetches items for the selected Feed with the current content-status filter.
 *
 * Should be called in a component that renders the feed items list.
 */
export function useLazyFeedFilter() {
  const feedFilter = useAtomValue(feedFilterAtom);
  const contentStatusFilter = useAtomValue(contentStatusFilterAtom);
  const fetchMoreItemsForFeed = useFetchMoreItemsForFeed();

  useEffect(() => {
    // feedFilter < 0 means no feed is selected
    if (feedFilter < 0) return;

    // Request items on mount/selection so another device's updates are merged.
    void fetchMoreItemsForFeed(feedFilter, contentStatusFilter, {
      force: true,
      resetCursor: true,
    });
  }, [feedFilter, fetchMoreItemsForFeed, contentStatusFilter]);
}
