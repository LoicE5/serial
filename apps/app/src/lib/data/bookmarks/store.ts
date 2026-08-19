import { createStore } from "zustand";
import { persist } from "zustand/middleware";
import { createNormalizedIDBStorage } from "../normalized-idb-storage";
import { createSelectorHooks } from "../createSelectorHooks";
import { e2eBookmarkHydrationBeforeRead } from "../e2eFaultControls";
import type { ApplicationBookmark } from "~/server/mixed-content/projection";

type PersistedBookmarkStore = {
  bookmarksDict: Record<string, ApplicationBookmark>;
};

type BookmarkStore = {
  revision: number;
  reset: () => void;
  replace: (bookmarks: Record<string, ApplicationBookmark>) => void;
  getBookmark: (id: string) => ApplicationBookmark | undefined;
  snapshot: () => Record<string, ApplicationBookmark>;
  upsert: (bookmark: ApplicationBookmark) => void;
  upsertMany: (bookmarks: ApplicationBookmark[]) => void;
  remove: (id: string) => void;
};

const bookmarkEntities: Record<string, ApplicationBookmark> = {};

function isPersistedBookmarkStore(
  value: unknown,
): value is PersistedBookmarkStore {
  return (
    typeof value === "object" && value !== null && "bookmarksDict" in value
  );
}

function replaceBookmarkEntities(
  bookmarks: Record<string, ApplicationBookmark>,
) {
  for (const id of Object.keys(bookmarkEntities)) delete bookmarkEntities[id];
  Object.assign(bookmarkEntities, bookmarks);
}

const vanillaBookmarkStore = createStore<BookmarkStore>()(
  persist(
    (set, get) => ({
      revision: 0,
      reset: () => {
        replaceBookmarkEntities({});
        set({ revision: get().revision + 1 });
      },
      replace: (bookmarks) => {
        replaceBookmarkEntities(bookmarks);
        set({ revision: get().revision + 1 });
      },
      getBookmark: (id) => bookmarkEntities[id],
      snapshot: () => bookmarkEntities,
      upsert: (bookmark) => {
        bookmarkEntities[bookmark.id] = bookmark;
        set({ revision: get().revision + 1 });
      },
      upsertMany: (bookmarks) => {
        if (bookmarks.length === 0) return;
        for (const bookmark of bookmarks) {
          bookmarkEntities[bookmark.id] = bookmark;
        }
        set({ revision: get().revision + 1 });
      },
      remove: (id) => {
        delete bookmarkEntities[id];
        set({ revision: get().revision + 1 });
      },
    }),
    {
      name: "serial-bookmarks-store",
      storage: createNormalizedIDBStorage({
        recordFields: ["bookmarksDict"],
        beforeRead: e2eBookmarkHydrationBeforeRead,
      }),
      partialize: () => ({ bookmarksDict: bookmarkEntities }),
      merge: (persistedState, currentState) => {
        if (isPersistedBookmarkStore(persistedState)) {
          replaceBookmarkEntities(persistedState.bookmarksDict);
        }
        return currentState;
      },
    },
  ),
);

export const bookmarksStore = createSelectorHooks(vanillaBookmarkStore);
