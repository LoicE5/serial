import { describe, expect, it } from "vitest";
import {
  buildContentStatusKey,
  CONTENT_STATUS_FILTERS,
  contentStatusFilterSchema,
  contentStatusOrderDimension,
  contentStatusUsesSectionOrder,
  isContentStatusAvailable,
  selectContentStatusOrderValue,
} from "~/lib/content-status";

describe("content status contract", () => {
  it("defines four collision-free status cells", () => {
    expect(CONTENT_STATUS_FILTERS.map(buildContentStatusKey)).toEqual([
      "inbox:unread",
      "inbox:archived",
      "saved:unread",
      "saved:archived",
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

  it("maps every status to nested availability", () => {
    const availability = {
      inbox: { unread: false, archived: true },
      saved: { unread: false, archived: true },
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
});
