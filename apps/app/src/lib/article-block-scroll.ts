"use client";

import { getScrollContainer } from "~/lib/scroll";

export const ARTICLE_BLOCK_SCROLL = {
  mediaViewportPosition: 1 / 2,
  textViewportPosition: 1 / 6,
} as const;

function isMediaBlock(element: HTMLElement) {
  return (
    element.tagName === "IMG" ||
    element.tagName === "FIGURE" ||
    !!element.querySelector("img")
  );
}

export function getArticleBlockTargetScrollTop(
  element: HTMLElement,
  container: HTMLElement = getScrollContainer(),
) {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const elementOffset = isMediaBlock(element) ? elementRect.height / 2 : 0;
  const viewportPosition = isMediaBlock(element)
    ? ARTICLE_BLOCK_SCROLL.mediaViewportPosition
    : ARTICLE_BLOCK_SCROLL.textViewportPosition;

  return (
    container.scrollTop +
    (elementRect.top - containerRect.top) -
    containerRect.height * viewportPosition +
    elementOffset
  );
}

export function scrollArticleBlockToTarget(
  element: HTMLElement,
  behavior: ScrollBehavior,
  container: HTMLElement = getScrollContainer(),
) {
  container.scrollTo({
    top: getArticleBlockTargetScrollTop(element, container),
    behavior,
  });
}

export function setArticleRestorationVisibility(
  element: HTMLElement,
  visible: boolean,
) {
  element.style.visibility = visible ? "" : "hidden";
}
