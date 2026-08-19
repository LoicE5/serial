// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://serial.test/" }

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApplicationView } from "~/server/db/schema";
import { InitialClientQueries } from "~/lib/data/InitialClientQueries";
import { ViewFilterChips } from "~/components/feed/ViewFilterChips";
import {
  categoryFilterAtom,
  dateFilterAtom,
  feedFilterAtom,
  UNSELECTED_VIEW_ID,
  viewFilterIdAtom,
  viewsAtom,
} from "~/lib/data/atoms";
import { viewsStore } from "~/lib/data/views/store";
import { mixedContentStore } from "~/lib/data/mixed-content/store";

const reconciliationMocks = vi.hoisted(() => ({
  activateScope: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("~/lib/data/useDataSubscription", () => ({
  useDataSubscription: vi.fn(),
}));
vi.mock("~/lib/data/reconciliation", () => ({
  dataReconciliation: reconciliationMocks,
  getCurrentReconciliationTarget: () => null,
}));
vi.mock("~/components/ButtonWithShortcut", () => ({
  KeyboardShortcutDisplay: () => null,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const NOW = new Date("2026-08-18T12:00:00.000Z");

function view(id: number, name: string, placement: number): ApplicationView {
  return {
    id,
    userId: "startup-view-user",
    name,
    daysWindow: id,
    readStatus: 0,
    contentFilter: 3,
    layout: "list",
    placement,
    createdAt: NOW,
    updatedAt: NOW,
    categoryIds: [],
    feedIds: [],
    isDefault: false,
    viewSections: [],
  };
}

function activeChip(container: HTMLElement) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.getAttribute("data-state") === "on",
  );
}

function nextTask() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  const atoms = getDefaultStore();
  atoms.set(viewsAtom, []);
  atoms.set(viewFilterIdAtom, UNSELECTED_VIEW_ID);
  atoms.set(feedFilterAtom, -1);
  atoms.set(categoryFilterAtom, -1);
  atoms.set(dateFilterAtom, 0);
  viewsStore.getState().reset();
  mixedContentStore.getState().reset();
  vi.clearAllMocks();
});

describe("initial cached View selection", () => {
  it("mounts with the first cached View active and repairs a deleted View", async () => {
    const cachedViews = [view(10, "Cached first", 0), view(20, "Second", 1)];
    viewsStore.setState({ views: cachedViews, fetchStatus: "success" });
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(
          InitialClientQueries,
          null,
          createElement(ViewFilterChips),
        ),
      );
      await nextTask();
    });

    expect(getDefaultStore().get(viewFilterIdAtom)).toBe(10);
    expect(getDefaultStore().get(dateFilterAtom)).toBe(10);
    expect(activeChip(container)?.textContent).toBe("Cached first");

    const authoritativeViews = [view(20, "Second", 0), view(30, "New", 1)];
    await act(async () => {
      viewsStore.setState({
        views: authoritativeViews,
        fetchStatus: "success",
      });
      await nextTask();
    });

    expect(getDefaultStore().get(viewFilterIdAtom)).toBe(20);
    expect(activeChip(container)?.textContent).toBe("Second");

    act(() => root.unmount());
  });
});
