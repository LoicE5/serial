// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://serial.test/" }

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApplicationView } from "~/server/db/schema";
import type { ContentStatusFilter } from "~/lib/content-status";
import { ViewFilterChips } from "~/components/feed/ViewFilterChips";
import {
  contentStatusFilterAtom,
  viewFilterIdAtom,
  viewsAtom,
} from "~/lib/data/atoms";
import { mixedContentStore } from "~/lib/data/mixed-content/store";
import { viewsStore } from "~/lib/data/views/store";

vi.mock("~/components/ButtonWithShortcut", () => ({
  KeyboardShortcutDisplay: () => null,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const NOW = new Date("2026-08-02T12:00:00.000Z");
const DEFAULT_STATUS = {
  saveStatus: "inbox",
  archiveStatus: "unread",
} as const satisfies ContentStatusFilter;

function view(id: number, name: string): ApplicationView {
  return {
    id,
    userId: "view-filter-user",
    name,
    daysWindow: 0,
    readStatus: 0,
    contentFilter: 3,
    layout: "list",
    placement: id,
    createdAt: NOW,
    updatedAt: NOW,
    categoryIds: [],
    feedIds: [],
    isDefault: false,
    viewSections: [],
  };
}

function setViewPage(
  viewId: number,
  hasContent: boolean,
  contentStatus: ContentStatusFilter = DEFAULT_STATUS,
) {
  mixedContentStore.getState().applyPage({
    scope: { type: "view", viewId },
    contentStatus,
    replacesScope: true,
    page: {
      references: hasContent
        ? [
            {
              entityKind: "feed-item",
              entityId: `item-${viewId}`,
              sectionPlacement: null,
              normalizedAt: NOW,
            },
          ]
        : [],
      feedItems: [],
      bookmarks: [],
      cursor: null,
      hasMore: false,
    },
  });
}

function renderViewFilterChips(
  input: {
    cachedViews?: ApplicationView[];
    hasFetchedViews?: boolean;
    contentStatus?: ContentStatusFilter;
  } = {},
) {
  const cachedViews = input.cachedViews ?? [
    view(1, "Reading"),
    view(2, "Research"),
  ];
  viewsStore.setState({
    views: cachedViews,
    fetchStatus: input.hasFetchedViews === false ? "idle" : "success",
  });
  const jotaiStore = createStore();
  jotaiStore.set(viewsAtom, cachedViews);
  jotaiStore.set(viewFilterIdAtom, 1);
  jotaiStore.set(
    contentStatusFilterAtom,
    input.contentStatus ?? DEFAULT_STATUS,
  );

  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(
        Provider,
        { store: jotaiStore },
        createElement(ViewFilterChips),
      ),
    );
  });
  const markup = container.innerHTML;
  act(() => root.unmount());
  return markup;
}

function chipFromMarkup(markup: string, label: string) {
  const container = document.createElement("div");
  container.innerHTML = markup;
  const chip = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === label,
  );
  if (!chip) throw new Error(`Missing ${label} View chip`);
  return chip;
}

afterEach(() => {
  mixedContentStore.getState().reset();
  viewsStore.getState().reset();
});

describe("View filter loading", () => {
  it("uses retained mixed pages while reconciliation is in flight", () => {
    setViewPage(1, true);
    setViewPage(2, false);

    const markup = renderViewFilterChips();

    expect(markup).toContain("Reading");
    expect(markup).toContain("Research");
    expect(markup).not.toContain('data-slot="skeleton"');
    expect(chipFromMarkup(markup, "Reading").classList).not.toContain(
      "opacity-50",
    );
    expect(chipFromMarkup(markup, "Research").classList).toContain(
      "opacity-50",
    );
  });

  it("previews four content-shaped View chips on a true first load", () => {
    const markup = renderViewFilterChips({
      cachedViews: [],
      hasFetchedViews: false,
    });

    expect(markup.match(/data-slot="skeleton"/g)).toHaveLength(4);
    for (const width of ["w-16", "w-22", "w-18", "w-26"]) {
      expect(markup).toContain(`h-8 ${width}`);
    }
  });

  it("updates dimming from replacement first pages", () => {
    setViewPage(1, true);
    setViewPage(2, false);
    setViewPage(1, false);
    setViewPage(2, true);

    const markup = renderViewFilterChips();

    expect(chipFromMarkup(markup, "Reading").classList).toContain("opacity-50");
    expect(chipFromMarkup(markup, "Research").classList).not.toContain(
      "opacity-50",
    );
  });

  it("maps Saved + Archived to its retained View page", () => {
    const contentStatus = {
      saveStatus: "saved",
      archiveStatus: "archived",
    } as const satisfies ContentStatusFilter;
    setViewPage(1, false, contentStatus);
    setViewPage(2, true, contentStatus);

    const markup = renderViewFilterChips({ contentStatus });

    expect(chipFromMarkup(markup, "Reading").classList).toContain("opacity-50");
    expect(chipFromMarkup(markup, "Research").classList).not.toContain(
      "opacity-50",
    );
  });

  it("does not dim an unknown View cell", () => {
    setViewPage(1, true);

    const markup = renderViewFilterChips();

    expect(chipFromMarkup(markup, "Reading").classList).not.toContain(
      "opacity-50",
    );
    expect(chipFromMarkup(markup, "Research").classList).not.toContain(
      "opacity-50",
    );
  });
});
