import { createStore } from "zustand";
import { persist } from "zustand/middleware";
import { createSelectorHooks } from "../createSelectorHooks";
import { createIDBStorage } from "../idb-storage";
import type {
  NavigationAvailability,
  NavigationSnapshot,
} from "~/server/navigation/snapshot";
import type { ContentAvailability } from "~/lib/content-status";
import { orpcRouterClient } from "~/lib/orpc";

const EMPTY_CONTENT_AVAILABILITY: ContentAvailability = {
  inbox: { unread: false, archived: false },
  saved: { unread: false, archived: false },
};

const EMPTY_SNAPSHOT: NavigationSnapshot = {
  tags: {},
  feeds: {},
  viewFeeds: {},
};

type NavigationSnapshotStore = {
  snapshot: NavigationSnapshot;
  fetchStatus: "idle" | "fetching" | "success";
  reset: () => void;
  set: (snapshot: NavigationSnapshot) => void;
  fetch: () => Promise<void>;
};

export type PersistedNavigationSnapshotState = Pick<
  NavigationSnapshotStore,
  "snapshot"
>;

function snapshotHasContent(snapshot: NavigationSnapshot) {
  return (
    Object.keys(snapshot.tags).length > 0 ||
    Object.keys(snapshot.feeds).length > 0 ||
    Object.keys(snapshot.viewFeeds).length > 0
  );
}

let activeFetch: Promise<void> | null = null;
let refetchRequested = false;
let requestGeneration = 0;

const vanillaNavigationSnapshotStore = createStore<NavigationSnapshotStore>()(
  persist<NavigationSnapshotStore, [], [], PersistedNavigationSnapshotState>(
    (set, get) => ({
      snapshot: EMPTY_SNAPSHOT,
      fetchStatus: "idle",
      reset: () => {
        requestGeneration++;
        refetchRequested = false;
        set({ snapshot: EMPTY_SNAPSHOT, fetchStatus: "idle" });
      },
      set: (snapshot) => {
        set({ snapshot, fetchStatus: "success" });
      },
      fetch: async () => {
        if (activeFetch) {
          refetchRequested = true;
          return activeFetch;
        }
        activeFetch = (async () => {
          do {
            refetchRequested = false;
            const fetchGeneration = requestGeneration;
            set({ fetchStatus: "fetching" });
            try {
              const snapshot =
                await orpcRouterClient.initial.getNavigationSnapshot();
              if (fetchGeneration === requestGeneration) {
                get().set(snapshot);
              }
            } catch (error) {
              if (fetchGeneration === requestGeneration) {
                set({ fetchStatus: "idle" });
              }
              throw error;
            }
          } while (refetchRequested);
        })();
        try {
          await activeFetch;
        } finally {
          activeFetch = null;
        }
      },
    }),
    {
      name: "serial-navigation-snapshot-store",
      storage: createIDBStorage<PersistedNavigationSnapshotState>(),
      version: 1,
      partialize: (state) => ({ snapshot: state.snapshot }),
      merge: (persistedState, currentState) => {
        // A fetch or reconciliation chunk may land before the async IDB read
        // settles; the live snapshot is fresher than the persisted one, so
        // rehydration must not overwrite it.
        if (currentState.fetchStatus === "success") {
          return currentState;
        }
        const merged = {
          ...currentState,
          ...(persistedState as Partial<NavigationSnapshotStore>),
        };
        if (snapshotHasContent(merged.snapshot)) {
          merged.fetchStatus = "success";
        }
        return merged;
      },
    },
  ),
);

export const navigationSnapshotStore = createSelectorHooks(
  vanillaNavigationSnapshotStore,
);

export function getNavigationAvailability(
  availability: Record<number, NavigationAvailability>,
  id: number,
): NavigationAvailability {
  return availability[id] ?? EMPTY_CONTENT_AVAILABILITY;
}

export const {
  useSnapshot: useNavigationSnapshot,
  useFetchStatus: useNavigationSnapshotStatus,
} = navigationSnapshotStore;

export function refreshNavigationSnapshot() {
  return navigationSnapshotStore.getState().fetch();
}

export async function refreshNavigationSnapshotSafely() {
  if (typeof window === "undefined") return;
  try {
    await refreshNavigationSnapshot();
  } catch (error) {
    console.error("Failed to refresh navigation snapshot", error);
  }
}
