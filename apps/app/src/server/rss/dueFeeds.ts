import { and, asc, count, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { db as Database } from "~/server/db";
import { feeds } from "~/server/db/schema";

export const RSS_FEED_PAGE_SIZE = 50;

export async function countDueFeeds(
  database: typeof Database,
  userId: string,
  now: Date,
) {
  const result = await database
    .select({ value: count() })
    .from(feeds)
    .where(
      and(
        eq(feeds.userId, userId),
        eq(feeds.isActive, true),
        or(lte(feeds.nextFetchAt, now), isNull(feeds.nextFetchAt)),
      ),
    )
    .get();
  return result?.value ?? 0;
}

export async function getDueFeedPage(
  database: typeof Database,
  input: { userId: string; afterFeedId?: number; now: Date },
) {
  return database
    .select()
    .from(feeds)
    .where(
      and(
        eq(feeds.userId, input.userId),
        eq(feeds.isActive, true),
        or(lte(feeds.nextFetchAt, input.now), isNull(feeds.nextFetchAt)),
        input.afterFeedId ? gt(feeds.id, input.afterFeedId) : undefined,
      ),
    )
    .orderBy(asc(feeds.id))
    .limit(RSS_FEED_PAGE_SIZE)
    .all();
}
