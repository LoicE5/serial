// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://serial.test/" }

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageValue } from "zustand/middleware";
import {
  INDEXED_DB_SCHEMA_KEY,
  INDEXED_DB_SCHEMA_VERSION,
} from "~/lib/data/indexed-db-schema";
import { createNormalizedIDBStorage } from "~/lib/data/normalized-idb-storage";

const indexedDb = vi.hoisted(() => ({
  entries: new Map<IDBValidKey, unknown>(),
  failRootReads: false,
}));

vi.mock("idb-keyval", () => ({
  clear: vi.fn(() => Promise.resolve(indexedDb.entries.clear())),
  del: vi.fn((key: IDBValidKey) =>
    Promise.resolve(indexedDb.entries.delete(key)),
  ),
  delMany: vi.fn((keys: IDBValidKey[]) => {
    for (const key of keys) indexedDb.entries.delete(key);
    return Promise.resolve();
  }),
  get: vi.fn((key: IDBValidKey) => {
    if (indexedDb.failRootReads && String(key).includes("::root")) {
      return Promise.reject(new Error("simulated read failure"));
    }
    return Promise.resolve(indexedDb.entries.get(key));
  }),
  getMany: vi.fn((keys: IDBValidKey[]) =>
    Promise.resolve(keys.map((key) => indexedDb.entries.get(key))),
  ),
  keys: vi.fn(() => Promise.resolve([...indexedDb.entries.keys()])),
  set: vi.fn((key: IDBValidKey, value: unknown) => {
    indexedDb.entries.set(key, value);
    return Promise.resolve();
  }),
  setMany: vi.fn((entries: Array<[IDBValidKey, unknown]>) => {
    for (const [key, value] of entries) indexedDb.entries.set(key, value);
    return Promise.resolve();
  }),
}));

const STORE = "serial-recovery-test-store";

type TestState = { dict: Record<string, { id: string }>; misc: number };

function storageValue(ids: string[]): StorageValue<TestState> {
  return {
    state: {
      dict: Object.fromEntries(ids.map((id) => [id, { id }])),
      misc: 1,
    },
    version: 0,
  };
}

function storedKeys() {
  return [...indexedDb.entries.keys()].filter(
    (key) => typeof key === "string" && key.startsWith(STORE),
  );
}

async function settleFlush() {
  await vi.advanceTimersByTimeAsync(3_000);
  // Drain the write chain's microtasks that fire after the timer callback.
  await vi.advanceTimersByTimeAsync(0);
}

describe("normalized IndexedDB storage recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // The schema gate is a module-level singleton whose first ensure() calls
    // clear() when the version key is missing. Seed it so each test is
    // self-sufficient regardless of execution order or filtering.
    indexedDb.entries.set(INDEXED_DB_SCHEMA_KEY, INDEXED_DB_SCHEMA_VERSION);
  });

  afterEach(() => {
    vi.useRealTimers();
    indexedDb.entries.clear();
    indexedDb.failRootReads = false;
  });

  it("sweeps stale record keys after a failed read so deleted entities cannot resurrect", async () => {
    const seeder = createNormalizedIDBStorage<TestState>({
      recordFields: ["dict"],
    });
    seeder.setItem(STORE, storageValue(["a", "b"]));
    await settleFlush();
    expect(storedKeys().some((key) => String(key).includes("b"))).toBe(true);

    // A fresh adapter (new page load) whose hydration read fails: it must
    // treat the cache as unknown, not as empty-and-clean.
    indexedDb.failRootReads = true;
    const adapter = createNormalizedIDBStorage<TestState>({
      recordFields: ["dict"],
    });
    await expect(adapter.getItem(STORE)).resolves.toBeNull();
    indexedDb.failRootReads = false;

    // The app deletes entity "b" and persists only "a". Without the
    // stale-key sweep, "b"'s record key survives the diffing write and the
    // prefix-scan reader resurrects it on the next load.
    adapter.setItem(STORE, storageValue(["a"]));
    await settleFlush();

    const reader = createNormalizedIDBStorage<TestState>({
      recordFields: ["dict"],
    });
    const restored = await reader.getItem(STORE);
    expect(restored?.state.dict).toEqual({ a: { id: "a" } });
    expect(
      storedKeys().filter((key) => String(key).includes("dict")),
    ).toHaveLength(1);
  });

  it("rewrites in full after a failed read even when the adapter had already flushed", async () => {
    // The truncation regression: a flush completes (lastValue is non-null),
    // then a concurrent read fails. The next flush must not diff against
    // lastValue after sweeping, or unchanged keys are deleted and never
    // rewritten.
    const adapter = createNormalizedIDBStorage<TestState>({
      recordFields: ["dict"],
    });
    adapter.setItem(STORE, storageValue(["a", "b"]));
    await settleFlush();

    indexedDb.failRootReads = true;
    await expect(adapter.getItem(STORE)).resolves.toBeNull();
    indexedDb.failRootReads = false;

    // A diff against lastValue would consider the root unchanged and skip
    // rewriting it after the sweep deleted it, leaving the cache unreadable.
    adapter.setItem(STORE, storageValue(["a", "b", "c"]));
    await settleFlush();

    const reader = createNormalizedIDBStorage<TestState>({
      recordFields: ["dict"],
    });
    const restored = await reader.getItem(STORE);
    expect(restored?.state.dict).toEqual({
      a: { id: "a" },
      b: { id: "b" },
      c: { id: "c" },
    });
  });

  it("sweeps orphan record keys left by a torn write with no root", async () => {
    const seeder = createNormalizedIDBStorage<TestState>({
      recordFields: ["dict"],
    });
    seeder.setItem(STORE, storageValue(["a", "b"]));
    await settleFlush();
    // A torn write: records landed but the root (written last) did not.
    indexedDb.entries.delete(`${STORE}::normalized:v1::root`);

    // A fresh load sees no root; it must treat the cache as unknown, not
    // as empty-and-clean.
    const adapter = createNormalizedIDBStorage<TestState>({
      recordFields: ["dict"],
    });
    await expect(adapter.getItem(STORE)).resolves.toBeNull();

    adapter.setItem(STORE, storageValue(["a"]));
    await settleFlush();

    const reader = createNormalizedIDBStorage<TestState>({
      recordFields: ["dict"],
    });
    const restored = await reader.getItem(STORE);
    expect(restored?.state.dict).toEqual({ a: { id: "a" } });
  });

  it("sweeps records landed by a partially-failed write", async () => {
    const adapter = createNormalizedIDBStorage<TestState>({
      recordFields: ["dict"],
    });
    adapter.setItem(STORE, storageValue(["a"]));
    await settleFlush();

    // Persist enough records that the upsert splits into two setMany
    // batches, and fail the second: the first batch lands on disk while
    // lastValue still describes the pre-write state.
    const idb = await import("idb-keyval");
    const many = Array.from({ length: 150 }, (_, index) => `n${index}`);
    vi.mocked(idb.setMany)
      .mockImplementationOnce((entries) => {
        for (const [key, value] of entries) indexedDb.entries.set(key, value);
        return Promise.resolve();
      })
      .mockImplementationOnce((entries) => {
        for (const [key, value] of entries) indexedDb.entries.set(key, value);
        return Promise.reject(new Error("simulated partial write failure"));
      });
    adapter.setItem(STORE, storageValue(many));
    await settleFlush();

    adapter.setItem(STORE, storageValue(["a"]));
    await settleFlush();

    const reader = createNormalizedIDBStorage<TestState>({
      recordFields: ["dict"],
    });
    const restored = await reader.getItem(STORE);
    expect(restored?.state.dict).toEqual({ a: { id: "a" } });
  });

  it("keeps a migrated legacy snapshot when deleting the legacy key fails", async () => {
    indexedDb.entries.set(STORE, storageValue(["a", "b"]));
    const idb = await import("idb-keyval");
    vi.mocked(idb.del).mockRejectedValueOnce(
      new Error("simulated del failure"),
    );

    const adapter = createNormalizedIDBStorage<TestState>({
      recordFields: ["dict"],
    });
    const restored = await adapter.getItem(STORE);
    expect(restored?.state.dict).toEqual({
      a: { id: "a" },
      b: { id: "b" },
    });

    // The next load reads the normalized root, not the leaked legacy blob.
    const reader = createNormalizedIDBStorage<TestState>({
      recordFields: ["dict"],
    });
    const reread = await reader.getItem(STORE);
    expect(reread?.state.dict).toEqual({
      a: { id: "a" },
      b: { id: "b" },
    });
  });
});
