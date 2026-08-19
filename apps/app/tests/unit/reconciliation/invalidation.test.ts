import { describe, expect, it } from "vitest";
import type {
  ReconciliationInvalidationMemberships,
  ReconciliationScopeTarget,
} from "~/lib/reconciliation";
import {
  buildBookmarkInvalidationSummary,
  buildFeedInvalidationSummary,
  expandInvalidationSummary,
} from "~/lib/reconciliation";

const memberships: ReconciliationInvalidationMemberships = {
  views: [
    { id: 10, categoryIds: [], feedIds: [7] },
    { id: 11, categoryIds: [20], feedIds: [] },
  ],
  viewFeedIds: { 10: [7] },
  feedCategories: [{ feedId: 7, categoryId: 20 }],
};

function target(
  scope: ReconciliationScopeTarget["scope"],
  saveStatus: "inbox" | "saved" = "inbox",
  archiveStatus: "unread" | "archived" = "unread",
): ReconciliationScopeTarget {
  return { type: "scope", scope, contentStatus: { saveStatus, archiveStatus } };
}

describe("reconciliation invalidation summaries", () => {
  it("expands Feed effects through Feed, View, and Tag memberships", () => {
    const retainedScopes = [
      target({ type: "feed", feedId: 7 }),
      target({ type: "view", viewId: 10 }),
      target({ type: "tag", tagId: 20 }),
      target({ type: "view", viewId: 11 }, "saved"),
    ];
    const expanded = expandInvalidationSummary({
      summary: buildFeedInvalidationSummary({
        feedIds: [7],
        contentStatusKeys: ["inbox:unread"],
      }),
      retainedScopes,
      memberships,
    });
    expect(expanded.scopeImpactUnknown).toBe(false);
    expect(expanded.scopes).toEqual(retainedScopes.slice(0, 3));
  });

  it("targets Bookmark status and View/Tag membership without Feed collision", () => {
    const retainedScopes = [
      target({ type: "view", viewId: 11 }, "saved"),
      target({ type: "tag", tagId: 20 }, "saved"),
      target({ type: "feed", feedId: 7 }, "saved"),
      target({ type: "view", viewId: 10 }, "saved"),
    ];
    const expanded = expandInvalidationSummary({
      summary: buildBookmarkInvalidationSummary({
        after: {
          isSaved: true,
          isRead: false,
          viewIds: [],
          tagIds: [20],
        },
      }),
      retainedScopes,
      memberships,
    });
    expect(expanded.scopes).toEqual(retainedScopes.slice(0, 2));
  });

  it("keeps an explicitly unknown scope impact distinct", () => {
    expect(
      expandInvalidationSummary({
        summary: {
          type: "reconciliation-invalidation",
          domains: ["organization", "navigation"],
          scopeImpact: { type: "unknown" },
        },
        retainedScopes: [target({ type: "view", viewId: 10 })],
        memberships,
      }),
    ).toEqual({ scopeImpactUnknown: true, scopes: [] });
  });
});
