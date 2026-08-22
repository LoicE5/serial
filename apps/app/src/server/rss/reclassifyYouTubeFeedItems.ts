import { and, asc, eq, isNull, lte, or } from "drizzle-orm";

import {
  YOUTUBE_ORIENTATION_RETRY_MS,
  YOUTUBE_RECLASSIFICATION_BATCH_SIZE,
} from "./youtubeOrientation";
import type { YouTubeOrientationProbeRun } from "./youtubeOrientation";
import type { db as Database } from "~/server/db";
import type { ApplicationFeedItem, DatabaseFeed } from "~/server/db/schema";
import { feedItems } from "~/server/db/schema";
import { dbSemaphore } from "~/lib/semaphore";

export async function reclassifyStoredYouTubeFeedItems(
  context: { db: typeof Database },
  feed: DatabaseFeed,
  probeRun: YouTubeOrientationProbeRun,
  options: { batchSize?: number; now?: Date } = {},
): Promise<ApplicationFeedItem[]> {
  if (feed.platform !== "youtube") return [];

  const now = options.now ?? new Date();
  const retryBefore = new Date(now.getTime() - YOUTUBE_ORIENTATION_RETRY_MS);
  const candidates = await dbSemaphore.run(() =>
    context.db
      .select()
      .from(feedItems)
      .where(
        and(
          eq(feedItems.feedId, feed.id),
          isNull(feedItems.orientation),
          or(
            isNull(feedItems.orientationCheckedAt),
            lte(feedItems.orientationCheckedAt, retryBefore),
          ),
        ),
      )
      // NULL attempts sort first. Once an ambiguous row is attempted, later
      // unchecked rows advance ahead of it instead of being starved.
      .orderBy(asc(feedItems.orientationCheckedAt), asc(feedItems.id))
      .limit(options.batchSize ?? YOUTUBE_RECLASSIFICATION_BATCH_SIZE)
      .all(),
  );
  if (candidates.length === 0) return [];

  const outcomes = await probeRun.classifyUrls(
    candidates.map((item) => item.url),
  );
  const updates = await Promise.all(
    candidates.map(async (item) => {
      const outcome = outcomes.get(item.url);
      if (
        !outcome ||
        (outcome.orientation === null && !outcome.attempted) ||
        (!outcome.checkedAt && outcome.orientation === null)
      ) {
        return null;
      }

      const rows = await dbSemaphore.run(() =>
        context.db
          .update(feedItems)
          .set({
            orientation: outcome.orientation ?? item.orientation,
            orientationCheckedAt: outcome.checkedAt,
          })
          .where(eq(feedItems.id, item.id))
          .returning(),
      );
      const updated = rows[0];
      if (!updated || outcome.orientation === null) return null;
      return {
        ...updated,
        platform: "youtube" as const,
      } as ApplicationFeedItem;
    }),
  );

  return updates.filter((item): item is ApplicationFeedItem => item !== null);
}
