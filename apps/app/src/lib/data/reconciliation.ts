import { getDefaultStore } from "jotai";
import { unstable_batchedUpdates } from "react-dom";
import { useSyncExternalStore } from "react";
import { bookmarksStore } from "./bookmarks/store";
import { contentCategoriesStore } from "./content-categories/store";
import { feedCategoriesStore } from "./feed-categories/store";
import { getFeedItemMembershipRevision } from "./feed-items/membershipRevision";
import { feedsStore } from "./feeds/store";
import { loadingActor, updateRefreshCooldown } from "./loading-machine";
import { getMixedScopeKey, mixedContentStore } from "./mixed-content/store";
import { navigationSnapshotStore } from "./navigation/store";
import { rssSummaryAffectsTarget } from "./rssRepair";
import { applyPublishedChunks } from "./subscriptionCoordinator";
import { feedItemsStore } from "./store";
import { viewFeedsStore } from "./view-feeds/store";
import { viewsStore } from "./views/store";
import { applyReconciliationFirstPage } from "./reconciliationPage";
import {
  categoryFilterAtom,
  contentStatusFilterAtom,
  dateFilterAtom,
  feedFilterAtom,
  UNSELECTED_VIEW_ID,
  viewFilterIdAtom,
} from "./atoms";
import type {
  ReconciliationEntityManifestEntry,
  ReconciliationHydrationDomain,
  ReconciliationInput,
  ReconciliationPageManifest,
  ReconciliationRequestDescriptor,
  ReconciliationScopeTarget,
  ReconciliationTarget,
} from "~/lib/reconciliation";
import type { PublishedChunk } from "~/server/api/publisher";
import type { RssAttemptSummary, RssTrigger } from "~/lib/rss";
import { orpcRouterClient } from "~/lib/orpc";
import {
  createReconciliationRuntime,
  expandInvalidationSummary,
  getBookmarkReconciliationVersion,
  getFeedItemReconciliationVersion,
  getReconciliationTargetKey,
  MAX_TARGETED_RECONCILIATION_TARGETS,
} from "~/lib/reconciliation";
import { DEFAULT_CONTENT_STATUS_FILTER } from "~/lib/content-status";

type PersistedStore = {
  persist: {
    hasHydrated: () => boolean;
    onFinishHydration: (listener: () => void) => () => void;
  };
};

function asPersistedStore(store: unknown) {
  return store as PersistedStore;
}

function reconciliationSessionId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `reconciliation-${Date.now()}-${Math.random()}`;
}

function currentSelection(): ReconciliationScopeTarget | null {
  const atoms = getDefaultStore();
  const contentStatus = atoms.get(contentStatusFilterAtom);
  const feedId = atoms.get(feedFilterAtom);
  if (feedId >= 0) {
    return {
      type: "scope",
      scope: { type: "feed", feedId },
      contentStatus,
    };
  }
  const tagId = atoms.get(categoryFilterAtom);
  if (tagId >= 0) {
    return {
      type: "scope",
      scope: { type: "tag", tagId },
      contentStatus,
    };
  }
  const viewId = atoms.get(viewFilterIdAtom);
  return viewId === UNSELECTED_VIEW_ID
    ? null
    : {
        type: "scope",
        scope: { type: "view", viewId },
        contentStatus,
      };
}

function firstPageManifest(
  target: ReconciliationScopeTarget,
): ReconciliationPageManifest {
  const scope =
    mixedContentStore.getState().scopes[
      getMixedScopeKey(target.scope, target.contentStatus)
    ];
  const rootPage = scope?.pages.find(
    (candidate) => candidate.requestCursorKey === "root",
  );
  if (!scope || !rootPage) return { feedItems: [], bookmarks: [] };

  const referencesByKey = new Map(
    scope.references.map((reference) => [
      `${reference.entityKind}:${reference.entityId}`,
      reference,
    ]),
  );
  const feedItems: ReconciliationEntityManifestEntry[] = [];
  const bookmarks: ReconciliationEntityManifestEntry[] = [];
  for (const referenceKey of rootPage.value.referenceKeys) {
    const reference = referencesByKey.get(referenceKey);
    if (!reference) continue;
    if (reference.entityKind === "feed-item") {
      const item = feedItemsStore.getState().feedItemsDict[reference.entityId];
      if (item) {
        feedItems.push({
          id: item.id,
          version: getFeedItemReconciliationVersion(item),
        });
      }
      continue;
    }
    const bookmark = bookmarksStore.getState().getBookmark(reference.entityId);
    if (bookmark) {
      bookmarks.push({
        id: bookmark.id,
        version: getBookmarkReconciliationVersion(bookmark),
      });
    }
  }
  return { feedItems, bookmarks };
}

function buildInput(
  request: ReconciliationRequestDescriptor,
): ReconciliationInput {
  if (request.intent.type === "full") {
    if ("coldContentStatus" in request.intent) {
      return {
        type: "full",
        reconciliationId: request.reconciliationId,
        selection: {
          type: "cold",
          contentStatus: request.intent.coldContentStatus,
          membershipRevision: getFeedItemMembershipRevision(),
        },
      };
    }
    const { selectedScope } = request.intent;
    return {
      type: "full",
      reconciliationId: request.reconciliationId,
      selection: {
        type: "selected",
        scope: selectedScope.scope,
        contentStatus: selectedScope.contentStatus,
        pageManifest: firstPageManifest(selectedScope),
        membershipRevision: getFeedItemMembershipRevision(),
      },
    };
  }

  return {
    type: "targeted",
    reconciliationId: request.reconciliationId,
    targets: request.intent.targets.map((target) => {
      if (target.type === "scope") {
        return {
          target,
          pageManifest: firstPageManifest(target),
          membershipRevision: getFeedItemMembershipRevision(),
        };
      }
      return target.type === "organization"
        ? { target: { type: "organization" as const } }
        : { target: { type: "navigation" as const } };
    }),
  };
}

function performanceMark(name: string, reconciliationId?: string) {
  if (typeof performance === "undefined") return;
  performance.mark(name);
  if (reconciliationId) performance.mark(`${name}:${reconciliationId}`);
}

function rssRepairMemberships() {
  return {
    viewFeedIds: feedItemsStore.getState().viewFeedIds,
    feedCategories: feedCategoriesStore.getState().feedCategories,
  };
}

function rssSummaryFrom(payloads: PublishedChunk[]) {
  return payloads
    .flatMap((payload) =>
      payload.source === "rss" && payload.chunk.type === "rss-attempt-complete"
        ? [payload.chunk]
        : [],
    )
    .at(-1);
}

function retainedRssTargets(
  summary: RssAttemptSummary,
  activeTarget: ReconciliationScopeTarget | null,
) {
  const activeKey = activeTarget
    ? getReconciliationTargetKey(activeTarget)
    : null;
  return Object.values(mixedContentStore.getState().scopes)
    .map(
      ({ scope, contentStatus }) =>
        ({
          type: "scope",
          scope,
          contentStatus,
        }) satisfies ReconciliationScopeTarget,
    )
    .filter(
      (target) =>
        getReconciliationTargetKey(target) !== activeKey &&
        rssSummaryAffectsTarget(summary, target, rssRepairMemberships()),
    );
}

function retainedScopeTargets(activeTarget: ReconciliationScopeTarget | null) {
  const targets = Object.values(mixedContentStore.getState().scopes).map(
    ({ scope, contentStatus }) =>
      ({
        type: "scope",
        scope,
        contentStatus,
      }) satisfies ReconciliationScopeTarget,
  );
  if (activeTarget) targets.push(activeTarget);
  return [
    ...new Map(
      targets.map((target) => [getReconciliationTargetKey(target), target]),
    ).values(),
  ];
}

function mutationInvalidationEffects(
  payloads: PublishedChunk[],
  activeTarget: ReconciliationScopeTarget | null,
) {
  const summaries = payloads.flatMap((payload) => {
    if (payload.source === "invalidation") return [payload.chunk];
    return payload.invalidation ? [payload.invalidation] : [];
  });
  if (summaries.length === 0) return null;

  const retainedScopes = retainedScopeTargets(activeTarget);
  const memberships = {
    views: viewsStore.getState().views,
    viewFeedIds: feedItemsStore.getState().viewFeedIds,
    feedCategories: feedCategoriesStore.getState().feedCategories,
  };
  const repairTargets = new Map<string, ReconciliationTarget>();
  const dirtyTargets = new Map<string, ReconciliationTarget>();
  let unknown = false;

  for (const summary of summaries) {
    for (const domain of summary.domains) {
      const target = { type: domain } satisfies ReconciliationTarget;
      repairTargets.set(getReconciliationTargetKey(target), target);
    }
    const expanded = expandInvalidationSummary({
      summary,
      retainedScopes,
      memberships,
    });
    unknown ||= expanded.scopeImpactUnknown;
    for (const target of expanded.scopes) {
      const key = getReconciliationTargetKey(target);
      if (
        target.scope.type === "view" ||
        (activeTarget && key === getReconciliationTargetKey(activeTarget))
      ) {
        repairTargets.set(key, target);
      } else {
        dirtyTargets.set(key, target);
      }
    }
  }

  const eagerTargets = [...repairTargets.values()];
  const fullIntent = activeTarget
    ? ({ type: "full", selectedScope: activeTarget } as const)
    : ({
        type: "full",
        coldContentStatus: DEFAULT_CONTENT_STATUS_FILTER,
      } as const);
  return {
    repairTargets: eagerTargets,
    dirtyTargets: [...dirtyTargets.values()],
    repairIntent: unknown
      ? fullIntent
      : eagerTargets.length > MAX_TARGETED_RECONCILIATION_TARGETS
        ? fullIntent
        : eagerTargets.length > 0
          ? ({ type: "targeted", targets: eagerTargets } as const)
          : undefined,
  };
}

let manualFullPromise: Promise<void> | null = null;
let resolveManualFull: (() => void) | null = null;
let rejectManualFull: ((error: Error) => void) | null = null;
let supersededManualFullId: string | null = null;

async function requestDueSources(trigger: RssTrigger) {
  const result = await orpcRouterClient.initial.fetchDueSources({ trigger });
  if (result.status !== "background-managed") {
    updateRefreshCooldown(new Date(result.nextRefreshAt));
  }
  return result;
}

const runtime = createReconciliationRuntime<PublishedChunk[]>({
  sessionId: reconciliationSessionId,
  now: () =>
    typeof performance === "undefined" ? Date.now() : performance.now(),
  buildInput,
  openStream: async (input, signal) =>
    orpcRouterClient.initial.reconcileApplicationState(input, { signal }),
  applyAuthoritative: (payload) => {
    switch (payload.type) {
      case "organization":
        unstable_batchedUpdates(() => {
          viewsStore.getState().set(payload.snapshot.views);
          viewsStore.setState({ fetchStatus: "success" });
          feedsStore.getState().set(payload.snapshot.feeds);
          feedsStore.setState({ fetchStatus: "success" });
          contentCategoriesStore.getState().set(payload.snapshot.tags);
          contentCategoriesStore.setState({ fetchStatus: "success" });
          feedCategoriesStore.getState().set(payload.snapshot.feedTags);
          feedCategoriesStore.setState({ fetchStatus: "success" });
          viewFeedsStore.getState().set(payload.snapshot.directViewFeeds);
          viewFeedsStore.setState({ fetchStatus: "success" });
          feedItemsStore.setState({
            hasInitialData: true,
            viewFeedIds: Object.fromEntries(
              payload.snapshot.effectiveViewFeeds.map(({ viewId, feedIds }) => [
                viewId,
                feedIds,
              ]),
            ),
          });
        });
        performanceMark("serial:reconciliation-organization-applied");
        return true;
      case "active-scope": {
        const applied = applyReconciliationFirstPage(payload.page);
        if (applied) {
          performanceMark("serial:reconciliation-active-scope-applied");
        }
        return applied;
      }
      case "navigation":
        navigationSnapshotStore.getState().set(payload.snapshot);
        performanceMark("serial:reconciliation-navigation-applied");
        return true;
    }
  },
  applyLiveEvent: (payloads) => {
    applyPublishedChunks(payloads, {
      refreshNavigation: false,
    });
    const activeTarget = currentSelection();
    const invalidationEffects = mutationInvalidationEffects(
      payloads,
      activeTarget,
    );
    const summary = rssSummaryFrom(payloads);
    const onlyRssPayloads = payloads.every(({ source }) => source === "rss");
    if (onlyRssPayloads && !summary) return;
    if (summary) {
      const repairTargets: ReconciliationTarget[] = [];
      if (summary.affectedFeeds.length > 0) {
        repairTargets.push({ type: "navigation" });
        if (
          activeTarget &&
          rssSummaryAffectsTarget(summary, activeTarget, rssRepairMemberships())
        ) {
          repairTargets.push(activeTarget);
        }
      }
      return {
        repairTargets,
        dirtyTargets: retainedRssTargets(summary, activeTarget),
        repairIntent: { type: "targeted", targets: repairTargets } as const,
      };
    }
    if (invalidationEffects) return invalidationEffects;
    return;
  },
  getCurrentSelection: currentSelection,
  mark: performanceMark,
  onParityApplied: ({ automaticRssOwner, reconciliationId }) => {
    loadingActor.send({ type: "INITIAL_DATA_COMPLETE" });
    if (resolveManualFull) {
      if (reconciliationId !== supersededManualFullId) resolveManualFull();
      return;
    }
    if (automaticRssOwner === "client") {
      void requestDueSources("automatic").catch((error: unknown) => {
        console.error("Automatic RSS attempt failed", error);
      });
    }
  },
  onFullReconciliationFailed: ({ reconciliationId }) => {
    if (reconciliationId !== supersededManualFullId) {
      rejectManualFull?.(new Error("Manual reconciliation failed"));
    }
  },
});

const organizationStores = [
  viewsStore,
  feedsStore,
  contentCategoriesStore,
  feedCategoriesStore,
  viewFeedsStore,
].map(asPersistedStore);
const activeScopeStores = [feedItemsStore, mixedContentStore].map(
  asPersistedStore,
);
const bookmarkStores = [bookmarksStore].map(asPersistedStore);
const allPersistedStores = [
  ...organizationStores,
  ...activeScopeStores,
  ...bookmarkStores,
];
let hydrationCleanups: Array<() => void> = [];

function observeHydration(stores: PersistedStore[], onHydrated: () => void) {
  let emitted = false;
  const check = () => {
    if (emitted || !stores.every((store) => store.persist.hasHydrated()))
      return;
    emitted = true;
    onHydrated();
  };
  const cleanups = stores.map((store) =>
    store.persist.onFinishHydration(check),
  );
  check();
  return () => cleanups.forEach((cleanup) => cleanup());
}

function observeDomainHydration(
  domain: ReconciliationHydrationDomain,
  stores: PersistedStore[],
) {
  return observeHydration(stores, () => runtime.hydrationComplete(domain));
}

export const dataReconciliation = {
  start() {
    if (hydrationCleanups.length > 0) return;
    const atoms = getDefaultStore();
    atoms.set(viewFilterIdAtom, UNSELECTED_VIEW_ID);
    atoms.set(feedFilterAtom, -1);
    atoms.set(categoryFilterAtom, -1);
    atoms.set(contentStatusFilterAtom, DEFAULT_CONTENT_STATUS_FILTER);
    atoms.set(dateFilterAtom, 0);
    loadingActor.send({ type: "INITIAL_LOAD_START" });
    runtime.hydrationComplete("navigation");
    hydrationCleanups = [
      observeDomainHydration("organization", organizationStores),
      observeDomainHydration("active-scope", activeScopeStores),
      observeDomainHydration("bookmarks", bookmarkStores),
      observeHydration(allPersistedStores, () => runtime.cacheUsable()),
    ];
    runtime.start();
  },
  stop() {
    hydrationCleanups.forEach((cleanup) => cleanup());
    hydrationCleanups = [];
    runtime.stop();
  },
  activateScope: runtime.activateScope,
  requestManualFull() {
    if (manualFullPromise) return manualFullPromise;
    manualFullPromise = new Promise<void>((resolve, reject) => {
      resolveManualFull = resolve;
      rejectManualFull = reject;
      const inFlight = runtime.getState().inFlight;
      supersededManualFullId =
        inFlight?.intent.type === "full" ? inFlight.reconciliationId : null;
      runtime.requestFull();
    }).finally(() => {
      manualFullPromise = null;
      resolveManualFull = null;
      rejectManualFull = null;
      supersededManualFullId = null;
    });
    return manualFullPromise;
  },
  requestDueSources,
  receivePublishedChunks(payloads: PublishedChunk[]) {
    let start = 0;
    while (start < payloads.length) {
      const rss = payloads[start]?.source === "rss";
      let end = start + 1;
      while (
        end < payloads.length &&
        (payloads[end]?.source === "rss") === rss
      ) {
        end++;
      }
      runtime.receiveLiveEvent(payloads.slice(start, end));
      start = end;
    }
  },
  environmentChanged: runtime.environmentChanged,
  sseConnectionChanged: runtime.sseConnectionChanged,
  getState: runtime.getState,
  subscribe: runtime.subscribe,
};

export function getCurrentReconciliationTarget() {
  return currentSelection();
}

export function getReconciliationTargetStatus(
  target: ReconciliationScopeTarget,
) {
  return runtime.getState().targets[getReconciliationTargetKey(target)]?.status;
}

export type ReconciliationDisplayStatus = "idle" | "syncing" | "retrying";

function reconciliationDisplayStatus(): ReconciliationDisplayStatus {
  const state = runtime.getState();
  if (state.cacheUsableAt === null) return "idle";
  if (state.inFlight) return "syncing";
  return state.retryPending ? "retrying" : "idle";
}

export function useReconciliationDisplayStatus() {
  return useSyncExternalStore(
    dataReconciliation.subscribe,
    reconciliationDisplayStatus,
    () => "idle" as const,
  );
}
