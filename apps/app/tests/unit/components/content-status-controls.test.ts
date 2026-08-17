// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://serial.test/" }

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentStatusControls } from "~/components/feed/ContentStatusControls";
import { contentStatusFilterAtom } from "~/lib/data/atoms";

vi.mock("~/components/ButtonWithShortcut", () => ({
  KeyboardShortcutDisplay: ({ shortcut }: { shortcut: string }) =>
    createElement("kbd", null, shortcut),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const roots: Array<ReturnType<typeof createRoot>> = [];

function renderControls() {
  const store = createStore();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      createElement(Provider, { store }, createElement(ContentStatusControls)),
    );
  });
  return { container, store };
}

function tab(container: HTMLElement, name: string) {
  const match = Array.from(container.querySelectorAll('[role="tab"]')).find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name ||
      candidate.textContent?.includes(name),
  );
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Missing ${name} tab`);
  }
  return match;
}

function selectTab(target: HTMLButtonElement) {
  target.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, button: 0, ctrlKey: false }),
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

describe("ContentStatusControls", () => {
  it("renders adjacent labeled save tabs and explicitly named icon tabs", () => {
    const { container } = renderControls();
    const lists = container.querySelectorAll('[role="tablist"]');

    expect(lists).toHaveLength(2);
    expect(tab(container, "Inbox").textContent).toContain("i");
    expect(tab(container, "Saved").textContent).toContain("b");
    expect(tab(container, "Switch to unread content").textContent).toContain(
      "u",
    );
    expect(tab(container, "Switch to archived content").textContent).toContain(
      "y",
    );
    expect(
      tab(container, "Switch to unread content").querySelector("svg"),
    ).not.toBeNull();
    expect(
      tab(container, "Switch to archived content").querySelector("svg"),
    ).not.toBeNull();
  });

  it("updates either axis without changing the other", () => {
    const { container, store } = renderControls();

    act(() => selectTab(tab(container, "Saved")));
    expect(store.get(contentStatusFilterAtom)).toEqual({
      saveStatus: "saved",
      archiveStatus: "unread",
    });
    expect(tab(container, "Saved").getAttribute("data-state")).toBe("active");

    act(() => selectTab(tab(container, "Switch to archived content")));
    expect(store.get(contentStatusFilterAtom)).toEqual({
      saveStatus: "saved",
      archiveStatus: "archived",
    });
    expect(tab(container, "Saved").getAttribute("data-state")).toBe("active");
    expect(
      tab(container, "Switch to archived content").getAttribute(
        "aria-selected",
      ),
    ).toBe("true");

    act(() => selectTab(tab(container, "Inbox")));
    expect(store.get(contentStatusFilterAtom)).toEqual({
      saveStatus: "inbox",
      archiveStatus: "archived",
    });
  });
});
