import { UNSELECTED_VIEW_ID } from "./atoms";

export function resolveStartupViewSelection<
  TView extends { id: number },
>(input: {
  views: TView[];
  viewId: number;
  feedId: number;
  tagId: number;
}): TView | null {
  const firstView = input.views[0];
  if (!firstView || input.feedId >= 0 || input.tagId >= 0) return null;
  if (input.viewId === UNSELECTED_VIEW_ID) return firstView;
  return input.views.some((view) => view.id === input.viewId)
    ? null
    : firstView;
}
