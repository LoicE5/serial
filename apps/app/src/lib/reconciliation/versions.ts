import type { ApplicationFeedItem } from "~/server/db/schema";
import type { ApplicationBookmark } from "~/server/mixed-content/projection";

export function getFeedItemReconciliationVersion(item: ApplicationFeedItem) {
  return [
    item.contentHash ?? "",
    item.updatedAt.toISOString(),
    item.isWatchedUpdatedAt?.toISOString() ?? "",
    item.isWatchLaterUpdatedAt?.toISOString() ?? "",
    item.progress,
    item.duration,
  ].join("|");
}

export function getBookmarkReconciliationVersion(
  bookmark: ApplicationBookmark,
) {
  return [
    bookmark.updatedAt.toISOString(),
    bookmark.savedUpdatedAt.toISOString(),
    bookmark.readUpdatedAt.toISOString(),
    bookmark.progressUpdatedAt.toISOString(),
    bookmark.captureHash ?? "",
    bookmark.capturedAt?.toISOString() ?? "",
    bookmark.viewIds.join(","),
    bookmark.tagIds.join(","),
  ].join("|");
}
