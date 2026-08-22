import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBookmarkTestDatabase } from "../bookmarks/database";
import type { YouTubeOrientationProbeStore } from "~/server/rss/youtubeOrientation";
import {
  YOUTUBE_ORIENTATION_RETRY_MS,
  YouTubeOrientationProbeRun,
} from "~/server/rss/youtubeOrientation";
import { reclassifyStoredYouTubeFeedItems } from "~/server/rss/reclassifyYouTubeFeedItems";
import { feedItems, feeds, user } from "~/server/db/schema";

type TestDatabase = Awaited<ReturnType<typeof createBookmarkTestDatabase>>;

const SHORT_ID = "PG_kfqOXqgQ";
const LATER_ID = "dQw4w9WgXcQ";
const CREATED_AT = new Date("2026-08-01T10:00:00.000Z");
const UPDATED_AT = new Date("2026-08-01T11:00:00.000Z");
const WATCHED_AT = new Date("2026-08-01T12:00:00.000Z");
const SAVED_AT = new Date("2026-08-01T13:00:00.000Z");

let testDatabase: TestDatabase;

function createStore(): YouTubeOrientationProbeStore {
  return {
    getClassifications: () => Promise.resolve([]),
    getCooldownUntil: () => Promise.resolve(null),
    setClassification: () => Promise.resolve(),
    setCooldownUntil: () => Promise.resolve(),
  };
}

async function seedFeedAndUser() {
  await testDatabase.database.insert(user).values({
    id: "user-1",
    name: "User",
    email: "user@example.com",
    emailVerified: true,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  });
  await testDatabase.database.insert(feeds).values({
    id: 1,
    userId: "user-1",
    name: "YouTube",
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=channel",
    platform: "youtube",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  });
}

async function seedItem(input: {
  id: string;
  videoId: string;
  archived?: boolean;
}) {
  await testDatabase.database.insert(feedItems).values({
    id: input.id,
    feedId: 1,
    contentId: input.videoId,
    title: input.id,
    author: "Author",
    url: `https://www.youtube.com/watch?v=${input.videoId}`,
    contentType: "video",
    orientation: null,
    postedAt: CREATED_AT,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    isWatched: input.archived ?? false,
    isWatchLater: input.archived ?? false,
    isWatchedUpdatedAt: input.archived ? WATCHED_AT : null,
    isWatchLaterUpdatedAt: input.archived ? SAVED_AT : null,
  });
}

beforeEach(async () => {
  testDatabase = await createBookmarkTestDatabase();
  await seedFeedAndUser();
});

afterEach(() => {
  testDatabase.cleanup();
});

describe("stored YouTube orientation reclassification", () => {
  it("corrects an existing Short in place while preserving archived state and timestamps", async () => {
    await seedItem({ id: "archived-short", videoId: SHORT_ID, archived: true });
    const probeRun = new YouTubeOrientationProbeRun(createStore(), {
      now: () => new Date("2026-08-22T12:00:00.000Z"),
      probe: () =>
        Promise.resolve({ orientation: "vertical", rateLimited: false }),
    });
    const feed = await testDatabase.database.query.feeds.findFirst({
      where: eq(feeds.id, 1),
    });

    const changed = await reclassifyStoredYouTubeFeedItems(
      { db: testDatabase.database },
      feed!,
      probeRun,
    );

    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      id: "archived-short",
      orientation: "vertical",
      isWatched: true,
      isWatchLater: true,
    });
    const stored = await testDatabase.database.query.feedItems.findFirst({
      where: eq(feedItems.id, "archived-short"),
    });
    expect(stored).toMatchObject({
      id: "archived-short",
      orientation: "vertical",
      isWatched: true,
      isWatchLater: true,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      isWatchedUpdatedAt: WATCHED_AT,
      isWatchLaterUpdatedAt: SAVED_AT,
    });
  });

  it("does not let a repeatedly ambiguous row starve a later unchecked row", async () => {
    await seedItem({ id: "ambiguous", videoId: SHORT_ID });
    let clock = new Date("2026-08-22T12:00:00.000Z");
    const probe = vi.fn((videoId: string) =>
      Promise.resolve({
        orientation: videoId === LATER_ID ? ("vertical" as const) : null,
        rateLimited: false,
      }),
    );
    const probeRun = new YouTubeOrientationProbeRun(createStore(), {
      maxConcurrentRequests: 1,
      now: () => clock,
      probe,
    });
    const feed = await testDatabase.database.query.feeds.findFirst({
      where: eq(feeds.id, 1),
    });

    await reclassifyStoredYouTubeFeedItems(
      { db: testDatabase.database },
      feed!,
      probeRun,
      { batchSize: 1, now: clock },
    );
    clock = new Date(clock.getTime() + YOUTUBE_ORIENTATION_RETRY_MS + 1);
    await reclassifyStoredYouTubeFeedItems(
      { db: testDatabase.database },
      feed!,
      probeRun,
      { batchSize: 1, now: clock },
    );

    await seedItem({ id: "later", videoId: LATER_ID });
    const changed = await reclassifyStoredYouTubeFeedItems(
      { db: testDatabase.database },
      feed!,
      probeRun,
      { batchSize: 1, now: clock },
    );

    expect(probe.mock.calls.map(([videoId]) => videoId)).toEqual([
      SHORT_ID,
      SHORT_ID,
      LATER_ID,
    ]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ id: "later", orientation: "vertical" });
  });
});
