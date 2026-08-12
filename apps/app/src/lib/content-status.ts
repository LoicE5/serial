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

const legacyVisibilityFilterSchema = z.enum(["unread", "read", "later"]);

export type ContentStatusKey = `${SaveStatus}:${ArchiveStatus}`;

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

export type ContentStatusAvailabilityKey =
  "unread" | "read" | "later" | "savedArchived";

export function buildContentStatusKey(
  filter: ContentStatusFilter,
): ContentStatusKey {
  return `${filter.saveStatus}:${filter.archiveStatus}`;
}

/** Map the two-axis selection onto main's flat availability vocabulary. */
export function contentStatusAvailabilityKey(
  filter: ContentStatusFilter,
): ContentStatusAvailabilityKey {
  if (filter.saveStatus === "saved") {
    return filter.archiveStatus === "archived" ? "savedArchived" : "later";
  }
  return filter.archiveStatus === "archived" ? "read" : "unread";
}

export function isContentStatusAvailable(
  availability:
    Partial<Record<ContentStatusAvailabilityKey, boolean>> | undefined,
  filter: ContentStatusFilter,
) {
  return availability?.[contentStatusAvailabilityKey(filter)] ?? false;
}

/** Compatibility mapping for the legacy control during the phased UI cutover. */
export function contentStatusFromVisibilityFilter(
  visibility: "unread" | "read" | "later",
): ContentStatusFilter {
  if (visibility === "read") return INBOX_ARCHIVED_CONTENT_STATUS;
  if (visibility === "later") return SAVED_UNREAD_CONTENT_STATUS;
  return INBOX_UNREAD_CONTENT_STATUS;
}

export function contentStatusFromScopeKey(
  scopeKey: string,
): ContentStatusFilter | undefined {
  const parts = scopeKey.split(":");
  const compoundResult = contentStatusFilterSchema.safeParse({
    saveStatus: parts.at(-2),
    archiveStatus: parts.at(-1),
  });
  if (compoundResult.success) return compoundResult.data;

  const legacyResult = legacyVisibilityFilterSchema.safeParse(parts.at(-1));
  return legacyResult.success
    ? contentStatusFromVisibilityFilter(legacyResult.data)
    : undefined;
}

/** Re-key retained main pages without changing or disposing the IndexedDB schema. */
export function upgradeLegacyContentStatusScopeKey(scopeKey: string) {
  const parts = scopeKey.split(":");
  const compoundResult = contentStatusFilterSchema.safeParse({
    saveStatus: parts.at(-2),
    archiveStatus: parts.at(-1),
  });
  if (compoundResult.success) return scopeKey;

  const contentStatus = contentStatusFromScopeKey(scopeKey);
  if (!contentStatus) return scopeKey;
  return [...parts.slice(0, -1), buildContentStatusKey(contentStatus)].join(
    ":",
  );
}

export function isInboxUnread(filter: ContentStatusFilter) {
  return filter.saveStatus === "inbox" && filter.archiveStatus === "unread";
}
