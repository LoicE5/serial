import { z } from "zod";

export const saveStatusSchema = z.enum(["inbox", "saved"]);
export type SaveStatus = z.infer<typeof saveStatusSchema>;

export const archiveStatusSchema = z.enum(["unread", "archived"]);
export type ArchiveStatus = z.infer<typeof archiveStatusSchema>;

export const contentStatusFilterSchema = z.object({
  saveStatus: saveStatusSchema,
  archiveStatus: archiveStatusSchema,
});
export type ContentStatusFilter = z.infer<typeof contentStatusFilterSchema>;

export type ContentStatusKey = `${SaveStatus}:${ArchiveStatus}`;

export type ContentAvailability = Record<
  SaveStatus,
  Record<ArchiveStatus, boolean>
>;

export const INBOX_UNREAD_CONTENT_STATUS = {
  saveStatus: "inbox",
  archiveStatus: "unread",
} as const satisfies ContentStatusFilter;

export const INBOX_ARCHIVED_CONTENT_STATUS = {
  saveStatus: "inbox",
  archiveStatus: "archived",
} as const satisfies ContentStatusFilter;

export const SAVED_UNREAD_CONTENT_STATUS = {
  saveStatus: "saved",
  archiveStatus: "unread",
} as const satisfies ContentStatusFilter;

export const SAVED_ARCHIVED_CONTENT_STATUS = {
  saveStatus: "saved",
  archiveStatus: "archived",
} as const satisfies ContentStatusFilter;

export const DEFAULT_CONTENT_STATUS_FILTER = INBOX_UNREAD_CONTENT_STATUS;

export const CONTENT_STATUS_FILTERS = [
  INBOX_UNREAD_CONTENT_STATUS,
  INBOX_ARCHIVED_CONTENT_STATUS,
  SAVED_UNREAD_CONTENT_STATUS,
  SAVED_ARCHIVED_CONTENT_STATUS,
] as const satisfies readonly ContentStatusFilter[];

export function buildContentStatusKey(
  filter: ContentStatusFilter,
): ContentStatusKey {
  return `${filter.saveStatus}:${filter.archiveStatus}`;
}

export function isInboxUnread(filter: ContentStatusFilter) {
  return filter.saveStatus === "inbox" && filter.archiveStatus === "unread";
}

export function isContentStatusAvailable(
  availability: ContentAvailability | undefined,
  filter: ContentStatusFilter,
) {
  return availability?.[filter.saveStatus][filter.archiveStatus] ?? false;
}
