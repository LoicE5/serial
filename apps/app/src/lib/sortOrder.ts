export function compareDescendingIds(leftId: string, rightId: string) {
  if (leftId === rightId) return 0;
  return leftId > rightId ? -1 : 1;
}

export function compareDescendingIdsThenKinds(
  leftId: string,
  rightId: string,
  leftKind: string,
  rightKind: string,
) {
  const idDifference = compareDescendingIds(leftId, rightId);
  return idDifference !== 0 ? idDifference : leftKind.localeCompare(rightKind);
}
