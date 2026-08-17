import type { ContentStatusFilter } from "~/lib/content-status";
import { selectContentStatusOrderValue } from "~/lib/content-status";

type FeedItemOrderTimestamps = {
  postedAt: Date;
  isWatchLaterUpdatedAt: Date | null;
  isWatchedUpdatedAt: Date | null;
};

export function selectFeedItemOrderCoordinate(
  contentStatus: ContentStatusFilter,
  item: FeedItemOrderTimestamps,
) {
  return selectContentStatusOrderValue(contentStatus, {
    published: item.postedAt,
    saved: item.isWatchLaterUpdatedAt ?? item.postedAt,
    archived: item.isWatchedUpdatedAt ?? item.postedAt,
  });
}
