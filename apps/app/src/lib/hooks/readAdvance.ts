import type { ContentStatusFilter } from "~/lib/content-status";

export function shouldAdvanceAfterToggleRead({
  contentStatusFilter,
}: {
  contentStatusFilter: ContentStatusFilter;
}) {
  return contentStatusFilter.archiveStatus === "unread";
}
