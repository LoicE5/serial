import { describe, expect, it } from "vitest";
import {
  buildContentStatusKey,
  CONTENT_STATUS_FILTERS,
  contentStatusAvailabilityKey,
  contentStatusFilterSchema,
  contentStatusFromScopeKey,
  contentStatusFromVisibilityFilter,
  contentStatusOrderDimension,
  contentStatusUsesSectionOrder,
  isContentStatusAvailable,
  selectContentStatusOrderValue,
  upgradeLegacyContentStatusScopeKey,
} from "~/lib/content-status";

describe("content status contract", () => {
  it("defines four collision-free status cells and flat availability keys", () => {
    expect(
      CONTENT_STATUS_FILTERS.map((filter) => ({
        key: buildContentStatusKey(filter),
        availability: contentStatusAvailabilityKey(filter),
      })),
    ).toEqual([
      { key: "inbox:unread", availability: "unread" },
      { key: "inbox:archived", availability: "read" },
      { key: "saved:unread", availability: "later" },
      { key: "saved:archived", availability: "savedArchived" },
    ]);
  });

  it("validates both axes and rejects incomplete or legacy-shaped values", () => {
    for (const filter of CONTENT_STATUS_FILTERS) {
      expect(contentStatusFilterSchema.parse(filter)).toEqual(filter);
    }
    expect(() =>
      contentStatusFilterSchema.parse({ saveStatus: "saved" }),
    ).toThrow();
    expect(() => contentStatusFilterSchema.parse("later")).toThrow();
  });

  it("maps every status to main's flat availability snapshot", () => {
    const availability = {
      unread: false,
      read: true,
      later: false,
      savedArchived: true,
    };

    expect(
      CONTENT_STATUS_FILTERS.map((filter) =>
        isContentStatusAvailable(availability, filter),
      ),
    ).toEqual([false, true, false, true]);
  });

  it("defines one archive-first ordering dimension for every adapter", () => {
    expect(CONTENT_STATUS_FILTERS.map(contentStatusOrderDimension)).toEqual([
      "published",
      "archived",
      "saved",
      "archived",
    ]);
    expect(
      CONTENT_STATUS_FILTERS.map((filter) =>
        selectContentStatusOrderValue(filter, {
          published: "publishedAt",
          saved: "savedAt",
          archived: "archivedAt",
        }),
      ),
    ).toEqual(["publishedAt", "archivedAt", "savedAt", "archivedAt"]);
    expect(CONTENT_STATUS_FILTERS.map(contentStatusUsesSectionOrder)).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  it("keeps the legacy three-state control compatible without inventing the fourth cell", () => {
    expect(contentStatusFromVisibilityFilter("unread")).toEqual(
      CONTENT_STATUS_FILTERS[0],
    );
    expect(contentStatusFromVisibilityFilter("read")).toEqual(
      CONTENT_STATUS_FILTERS[1],
    );
    expect(contentStatusFromVisibilityFilter("later")).toEqual(
      CONTENT_STATUS_FILTERS[2],
    );
  });

  it("upgrades retained legacy keys in place without a cache version change", () => {
    expect(upgradeLegacyContentStatusScopeKey("view:7:unread")).toBe(
      "view:7:inbox:unread",
    );
    expect(upgradeLegacyContentStatusScopeKey("mixed:tag:4:later")).toBe(
      "mixed:tag:4:saved:unread",
    );
    expect(upgradeLegacyContentStatusScopeKey("view:7:saved:archived")).toBe(
      "view:7:saved:archived",
    );
    expect(contentStatusFromScopeKey("view:7:saved:archived")).toEqual(
      CONTENT_STATUS_FILTERS[3],
    );
    expect(upgradeLegacyContentStatusScopeKey("view:7:unknown")).toBe(
      "view:7:unknown",
    );
  });
});
