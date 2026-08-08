"use client";

import { useLayoutEffect, useRef } from "react";
import { getElements } from "./useArticleNavigation";
import { getShortcutKeys, SHORTCUT_KEYS } from "~/lib/constants/shortcuts";
import { getScrollContainer } from "~/lib/scroll";

const TARGET_VIEWPORT_POSITION = 1 / 3;
const READER_SCROLL_KEYS = new Set([
  ...getShortcutKeys(SHORTCUT_KEYS.ARROW_UP),
  ...getShortcutKeys(SHORTCUT_KEYS.ARROW_DOWN),
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

export function useRestoreArticleProgress({
  contentId,
  articleElement,
  progress,
  ready = true,
}: {
  contentId: string;
  articleElement: HTMLElement | null;
  progress: number | undefined;
  ready?: boolean;
}) {
  const restoredContentIdRef = useRef<string | null>(null);
  const hasUserInteractedRef = useRef(false);

  useLayoutEffect(() => {
    hasUserInteractedRef.current = false;
    const container = getScrollContainer();
    const markUserInteraction = () => {
      hasUserInteractedRef.current = true;
    };
    const handleKeydown = (event: KeyboardEvent) => {
      if (READER_SCROLL_KEYS.has(event.key)) markUserInteraction();
    };

    container.addEventListener("wheel", markUserInteraction, { passive: true });
    container.addEventListener("pointerdown", markUserInteraction, {
      passive: true,
    });
    container.addEventListener("touchstart", markUserInteraction, {
      passive: true,
    });
    window.addEventListener("keydown", handleKeydown);

    return () => {
      container.removeEventListener("wheel", markUserInteraction);
      container.removeEventListener("pointerdown", markUserInteraction);
      container.removeEventListener("touchstart", markUserInteraction);
      window.removeEventListener("keydown", handleKeydown);
    };
  }, [contentId]);

  useLayoutEffect(() => {
    if (
      !ready ||
      !articleElement ||
      progress === undefined ||
      restoredContentIdRef.current === contentId ||
      hasUserInteractedRef.current
    ) {
      return;
    }
    const savedProgress = progress;
    const contentElement = articleElement;

    let firstFrame = 0;
    let secondFrame = 0;
    const observer = new MutationObserver(() => scheduleRestore());

    function scheduleRestore() {
      if (
        firstFrame ||
        restoredContentIdRef.current === contentId ||
        hasUserInteractedRef.current
      ) {
        return;
      }
      const elements = getElements(contentElement);
      if (
        elements.length === 0 ||
        contentElement.querySelector("[data-reader-content-pending]")
      ) {
        return;
      }

      if (savedProgress <= 0) {
        restoredContentIdRef.current = contentId;
        observer.disconnect();
        getScrollContainer().scrollTo({ top: 0, behavior: "instant" });
        return;
      }

      firstFrame = requestAnimationFrame(() => {
        firstFrame = 0;
        secondFrame = requestAnimationFrame(() => {
          secondFrame = 0;
          if (hasUserInteractedRef.current) return;
          const renderedElements = getElements(contentElement);
          if (
            renderedElements.length === 0 ||
            contentElement.querySelector("[data-reader-content-pending]")
          ) {
            return;
          }

          restoredContentIdRef.current = contentId;
          observer.disconnect();
          const container = getScrollContainer();
          const element =
            renderedElements[
              Math.min(savedProgress, renderedElements.length - 1)
            ]!;
          const containerRect = container.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();
          const scrollTop =
            container.scrollTop +
            (elementRect.top - containerRect.top) -
            containerRect.height * TARGET_VIEWPORT_POSITION +
            elementRect.height / 2;
          container.scrollTo({ top: scrollTop, behavior: "instant" });
        });
      });
    }

    observer.observe(contentElement, { childList: true, subtree: true });
    scheduleRestore();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [articleElement, contentId, progress, ready]);
}
