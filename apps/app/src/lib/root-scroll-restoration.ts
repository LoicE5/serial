"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import {
  getFeedItemElement,
  scrollRootItemToTarget,
} from "~/lib/hooks/useScrollToFeedItem";
import { getScrollContainer } from "~/lib/scroll";

type RootNavigationAnchor = {
  selectedItemId: string | null;
  successorItemId: string | null;
};

type CurrentRootNavigation = {
  itemIds: readonly string[];
  selectedItemId: string | null;
};

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

let currentRootNavigation: CurrentRootNavigation = {
  itemIds: [],
  selectedItemId: null,
};
let pendingRootNavigationAnchor: RootNavigationAnchor | null = null;
let savedRootRenderedItemCount: number | null = null;
let savedRootRenderedItemListKey: string | null = null;
let currentRootRenderedItemCount: number | null = null;
let currentRootRenderedItemListKey: string | null = null;

export function getNextRootItemId(
  itemIds: readonly string[],
  currentItemId: string | null,
) {
  if (!currentItemId) return null;

  const currentIndex = itemIds.indexOf(currentItemId);
  return currentIndex >= 0 ? (itemIds[currentIndex + 1] ?? null) : null;
}

export function resolveRootRestorationItemId({
  activeItemIds,
  selectedItemId,
  successorItemId,
}: {
  activeItemIds: readonly string[];
  selectedItemId: string | null;
  successorItemId: string | null;
}) {
  const activeItemIdSet = new Set(activeItemIds);
  if (selectedItemId && activeItemIdSet.has(selectedItemId)) {
    return selectedItemId;
  }
  if (successorItemId && activeItemIdSet.has(successorItemId)) {
    return successorItemId;
  }
  return null;
}

export function captureRootScrollRestoration(
  departingItemId: string | null = currentRootNavigation.selectedItemId,
) {
  const { itemIds } = currentRootNavigation;
  pendingRootNavigationAnchor = {
    selectedItemId: departingItemId,
    successorItemId: getNextRootItemId(itemIds, departingItemId),
  };

  if (
    currentRootRenderedItemListKey !== null &&
    currentRootRenderedItemCount !== null
  ) {
    savedRootRenderedItemListKey = currentRootRenderedItemListKey;
    savedRootRenderedItemCount = currentRootRenderedItemCount;
  }
}

export function updateCurrentRootRenderedItemCount(
  listKey: string,
  renderedItemCount: number,
) {
  currentRootRenderedItemListKey = listKey;
  currentRootRenderedItemCount = renderedItemCount;
}

export function getSavedRootRenderedItemCount(listKey: string) {
  if (savedRootRenderedItemListKey !== listKey) return null;

  return savedRootRenderedItemCount;
}

export function useRootScrollResetBeforePaint(enabled: boolean) {
  useIsomorphicLayoutEffect(() => {
    if (!enabled) return;
    getScrollContainer().scrollTo({ top: 0, behavior: "instant" });
  }, [enabled]);
}

export function useRootItemScrollRestoration({
  activeItemIds,
  selectedItemId,
  setSelectedItemId,
  ready,
}: {
  activeItemIds: readonly string[];
  selectedItemId: string | null;
  setSelectedItemId: (itemId: string | null) => void;
  ready: boolean;
}) {
  const needsRestorationRef = useRef(true);
  const restorationAnchorRef = useRef<RootNavigationAnchor | null>(null);

  useIsomorphicLayoutEffect(() => {
    currentRootNavigation = {
      itemIds: activeItemIds,
      selectedItemId,
    };
  }, [activeItemIds, selectedItemId]);

  useIsomorphicLayoutEffect(() => {
    if (!ready) return;

    restorationAnchorRef.current ??= pendingRootNavigationAnchor ?? {
      selectedItemId,
      successorItemId: null,
    };
    const restorationAnchor = restorationAnchorRef.current;
    const restorationItemId = resolveRootRestorationItemId({
      activeItemIds,
      ...restorationAnchor,
    });
    const selectedAnchorLeftList =
      selectedItemId === restorationAnchor.selectedItemId &&
      restorationItemId !== restorationAnchor.selectedItemId;
    const shouldRestore = needsRestorationRef.current || selectedAnchorLeftList;

    if (!shouldRestore) {
      if (selectedItemId !== restorationAnchor.selectedItemId) {
        restorationAnchorRef.current = null;
      }
      return;
    }

    if (selectedItemId !== restorationItemId) {
      needsRestorationRef.current = true;
      setSelectedItemId(restorationItemId);
      return;
    }

    if (restorationItemId) {
      const itemElement = getFeedItemElement(restorationItemId);
      if (!itemElement) return;
      scrollRootItemToTarget(itemElement, "instant");
    } else {
      getScrollContainer().scrollTo({ top: 0, behavior: "instant" });
    }

    pendingRootNavigationAnchor = null;
    needsRestorationRef.current = false;
    if (restorationItemId !== restorationAnchor.selectedItemId) {
      restorationAnchorRef.current = null;
    }
  }, [activeItemIds, ready, selectedItemId, setSelectedItemId]);
}
