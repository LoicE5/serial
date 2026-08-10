"use client";

import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { categoryFilterAtom, contentStatusFilterAtom } from "~/lib/data/atoms";
import { useFetchMoreItemsForCategory } from "~/lib/data/store";

/**
 * Hook that triggers lazy loading of items when a category is selected.
 * Fetches items for Feeds in the selected Tag with the current content-status filter.
 *
 * Should be called in a component that renders the feed items list.
 */
export function useLazyCategoryFilter() {
  const categoryFilter = useAtomValue(categoryFilterAtom);
  const contentStatusFilter = useAtomValue(contentStatusFilterAtom);
  const fetchMoreItemsForCategory = useFetchMoreItemsForCategory();

  useEffect(() => {
    // categoryFilter < 0 means no category is selected
    if (categoryFilter < 0) return;

    // Request items on mount/selection so another device's updates are merged.
    void fetchMoreItemsForCategory(categoryFilter, contentStatusFilter, {
      force: true,
      resetCursor: true,
    });
  }, [categoryFilter, fetchMoreItemsForCategory, contentStatusFilter]);
}
