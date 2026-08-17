export const SCROLL_POSITION_TOLERANCE_PX = 50;

export function getScrollPositionDelta(actual: number, expected: number) {
  return Math.abs(actual - expected);
}
