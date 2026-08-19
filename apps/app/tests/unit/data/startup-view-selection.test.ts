import { describe, expect, it } from "vitest";
import { resolveStartupViewSelection } from "~/lib/data/startupViewSelection";
import { UNSELECTED_VIEW_ID } from "~/lib/data/atoms";

const views = [{ id: 10 }, { id: 20 }, { id: 30 }];

describe("startup View selection", () => {
  it("opens the first cached View when no scope is selected", () => {
    expect(
      resolveStartupViewSelection({
        views,
        viewId: UNSELECTED_VIEW_ID,
        feedId: -1,
        tagId: -1,
      }),
    ).toEqual(views[0]);
  });

  it("preserves a cached or user selection that remains authoritative", () => {
    expect(
      resolveStartupViewSelection({
        views: [{ id: 20 }, { id: 10 }],
        viewId: 10,
        feedId: -1,
        tagId: -1,
      }),
    ).toBeNull();
  });

  it("repairs a missing cached View to the authoritative first View", () => {
    expect(
      resolveStartupViewSelection({
        views,
        viewId: 404,
        feedId: -1,
        tagId: -1,
      }),
    ).toEqual(views[0]);
  });

  it("does not override an active Feed or Tag", () => {
    expect(
      resolveStartupViewSelection({
        views,
        viewId: UNSELECTED_VIEW_ID,
        feedId: 5,
        tagId: -1,
      }),
    ).toBeNull();
    expect(
      resolveStartupViewSelection({
        views,
        viewId: UNSELECTED_VIEW_ID,
        feedId: -1,
        tagId: 6,
      }),
    ).toBeNull();
  });
});
