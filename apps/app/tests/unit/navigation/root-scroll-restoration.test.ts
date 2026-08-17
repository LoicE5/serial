import { describe, expect, it, vi } from "vitest";
import {
  getNextRootItemId,
  resolveRootRestorationItemId,
} from "~/lib/root-scroll-restoration";
import { scrollRootItemToTarget } from "~/lib/hooks/useScrollToFeedItem";

function rect(input: { top: number; height: number }): DOMRect {
  return {
    top: input.top,
    bottom: input.top + input.height,
    height: input.height,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: input.top,
    toJSON: () => ({}),
  };
}

describe("root scroll restoration", () => {
  it("computes the immediate successor without falling backward", () => {
    const items = ["first", "selected", "next"];

    expect(getNextRootItemId(items, "selected")).toBe("next");
    expect(getNextRootItemId(items, "next")).toBeNull();
    expect(getNextRootItemId(items, "missing")).toBeNull();
    expect(getNextRootItemId(items, null)).toBeNull();
  });

  it("restores the selection, then its captured successor, then the top", () => {
    expect(
      resolveRootRestorationItemId({
        activeItemIds: ["selected", "next"],
        selectedItemId: "selected",
        successorItemId: "next",
      }),
    ).toBe("selected");

    expect(
      resolveRootRestorationItemId({
        activeItemIds: ["first", "next"],
        selectedItemId: "selected",
        successorItemId: "next",
      }),
    ).toBe("next");

    expect(
      resolveRootRestorationItemId({
        activeItemIds: ["first"],
        selectedItemId: "selected",
        successorItemId: "next",
      }),
    ).toBeNull();
  });

  it("places the selected item's center one-third down the viewport", () => {
    const scrollTo = vi.fn();
    const container = {
      scrollTop: 300,
      getBoundingClientRect: () => rect({ top: 40, height: 900 }),
      scrollTo,
    } as unknown as HTMLElement;
    const item = {
      getBoundingClientRect: () => rect({ top: 640, height: 120 }),
    } as unknown as Element;

    scrollRootItemToTarget(item, "instant", container);

    expect(scrollTo).toHaveBeenCalledWith({
      top: 660,
      behavior: "instant",
    });
  });
});
