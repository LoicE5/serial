"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";
import {
  categoryFilterAtom,
  contentStatusFilterAtom,
  feedFilterAtom,
  viewFilterIdAtom,
  viewsAtom,
} from "./atoms";

import { useDataSubscription } from "./useDataSubscription";
import { useViewsFetchStatus, useViews as useViewsStore } from "./views/store";
import { useUpdateViewFilter } from "./views";
import { resolveStartupViewSelection } from "./startupViewSelection";
import {
  dataReconciliation,
  getCurrentReconciliationTarget,
} from "./reconciliation";
import type { PropsWithChildren } from "react";

export function InitialClientQueries({ children }: PropsWithChildren) {
  useDataSubscription();

  // Sync views store with viewsAtom for compatibility
  const viewsFromStore = useViewsStore();
  const viewsFetchStatus = useViewsFetchStatus();
  const setViewsAtom = useSetAtom(viewsAtom);

  const viewFilterId = useAtomValue(viewFilterIdAtom);
  const feedFilter = useAtomValue(feedFilterAtom);
  const categoryFilter = useAtomValue(categoryFilterAtom);
  const contentStatusFilter = useAtomValue(contentStatusFilterAtom);
  const updateViewFilter = useUpdateViewFilter();

  useEffect(() => {
    dataReconciliation.start();
    return () => dataReconciliation.stop();
  }, []);

  // Keep viewsAtom always in sync with store
  useEffect(() => {
    if (viewsFetchStatus === "success" && viewsFromStore.length > 0) {
      setViewsAtom(viewsFromStore);
      const startupView = resolveStartupViewSelection({
        views: viewsFromStore,
        viewId: viewFilterId,
        feedId: feedFilter,
        tagId: categoryFilter,
      });
      if (startupView) {
        updateViewFilter(startupView.id, viewsFromStore);
      }
    }
  }, [
    categoryFilter,
    feedFilter,
    setViewsAtom,
    updateViewFilter,
    viewFilterId,
    viewsFetchStatus,
    viewsFromStore,
  ]);

  useEffect(() => {
    const target = getCurrentReconciliationTarget();
    if (target) dataReconciliation.activateScope(target);
  }, [viewFilterId, feedFilter, categoryFilter, contentStatusFilter]);

  return children;
}
