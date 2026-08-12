import { describe, expect, it } from "vitest";
import {
  buildContentStatusKey,
  CONTENT_STATUS_FILTERS,
  contentStatusAvailabilityKey,
  contentStatusFilterSchema,
  contentStatusFromVisibilityFilter,
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

  it("adapts the current three-state transport without inventing the fourth cell", () => {
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
});
