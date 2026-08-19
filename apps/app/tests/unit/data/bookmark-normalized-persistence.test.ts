// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://serial.test/" }

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApplicationBookmark } from "~/server/mixed-content/projection";

const indexedDb = vi.hoisted(() => ({
  entries: new Map<IDBValidKey, unknown>(),
}));

function cloneStoredValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

vi.mock("idb-keyval", () => ({
  clear: vi.fn(() => Promise.resolve(indexedDb.entries.clear())),
  del: vi.fn((key: IDBValidKey) =>
    Promise.resolve(indexedDb.entries.delete(key)),
  ),
  delMany: vi.fn((keys: IDBValidKey[]) => {
    for (const key of keys) indexedDb.entries.delete(key);
    return Promise.resolve();
  }),
  get: vi.fn((key: IDBValidKey) =>
    Promise.resolve(cloneStoredValue(indexedDb.entries.get(key))),
  ),
  getMany: vi.fn((keys: IDBValidKey[]) =>
    Promise.resolve(
      keys.map((key) => cloneStoredValue(indexedDb.entries.get(key))),
    ),
  ),
  keys: vi.fn(() => Promise.resolve([...indexedDb.entries.keys()])),
  set: vi.fn((key: IDBValidKey, value: unknown) => {
    indexedDb.entries.set(key, cloneStoredValue(value));
    return Promise.resolve();
  }),
  setMany: vi.fn((entries: Array<[IDBValidKey, unknown]>) => {
    for (const [key, value] of entries) {
      indexedDb.entries.set(key, cloneStoredValue(value));
    }
    return Promise.resolve();
  }),
}));

type PersistedStore = {
  persist: {
    hasHydrated: () => boolean;
    rehydrate: () => Promise<void> | void;
  };
};

function bookmark(
  id: string,
  overrides: Partial<ApplicationBookmark> = {},
): ApplicationBookmark {
  const now = new Date(Date.UTC(2026, 0, 1));
  return {
    id,
    userId: "user-one",
    sourceUrl: `https://example.com/${id}`,
    effectiveUrl: `https://example.com/${id}`,
    canonicalUrl: `https://example.com/${id}`,
    platform: "website",
    contentType: "text",
    orientation: null,
    contentId: null,
    classificationSource: "url",
    classifierVersion: 1,
    isSaved: true,
    isRead: false,
    progress: 0,
    duration: 0,
    savedUpdatedAt: now,
    readUpdatedAt: now,
    progressUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
    title: id,
    description: null,
    author: null,
    siteName: "example.com",
    publishedAt: null,
    iconUrl: null,
    thumbnailUrl: null,
    previewSource: "url",
    captureHash: null,
    capturedAt: null,
    viewIds: [],
    tagIds: [],
    ...overrides,
  };
}

async function importHydratedBookmarkStore() {
  const { bookmarksStore } = await import("~/lib/data/bookmarks/store");
  const persistence = bookmarksStore as typeof bookmarksStore & PersistedStore;
  await persistence.persist.rehydrate();
  expect(persistence.persist.hasHydrated()).toBe(true);
  return bookmarksStore;
}

function flushOnPageHide() {
  window.dispatchEvent(new Event("pagehide"));
}

afterEach(() => {
  indexedDb.entries.clear();
  vi.resetModules();
});

describe("Bookmark normalized persistence", () => {
  it("reloads retained upserts after an earlier flush and omits evicted bodies", async () => {
    const bookmarksStore = await importHydratedBookmarkStore();
    const retained = bookmark("retained");
    const retainedMany = bookmark("retained-many");
    const evicted = bookmark("evicted");

    bookmarksStore.getState().upsertMany([retained, retainedMany, evicted]);
    flushOnPageHide();
    await vi.waitFor(() =>
      expect(
        [...indexedDb.entries.keys()].filter(
          (key) =>
            typeof key === "string" && key.includes("record:bookmarksDict:"),
        ),
      ).toHaveLength(3),
    );

    bookmarksStore.getState().upsert(bookmark(retained.id, { progress: 10 }));
    bookmarksStore
      .getState()
      .upsertMany([
        bookmark(retainedMany.id, { progress: 20 }),
        bookmark("pinned", { progress: 30 }),
      ]);
    bookmarksStore
      .getState()
      .pruneExcept(new Set([retained.id, retainedMany.id, "pinned"]));
    flushOnPageHide();
    await vi.waitFor(() =>
      expect(
        [...indexedDb.entries.keys()].some(
          (key) => typeof key === "string" && key.endsWith("evicted"),
        ),
      ).toBe(false),
    );

    vi.resetModules();
    const reloadedStore = await importHydratedBookmarkStore();

    expect(reloadedStore.getState().getBookmark(retained.id)?.progress).toBe(
      10,
    );
    expect(
      reloadedStore.getState().getBookmark(retainedMany.id)?.progress,
    ).toBe(20);
    expect(reloadedStore.getState().getBookmark("pinned")?.progress).toBe(30);
    expect(reloadedStore.getState().getBookmark(evicted.id)).toBeUndefined();
  });
});
