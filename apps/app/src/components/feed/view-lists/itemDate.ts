export function getBookmarkAddedAt(bookmark: {
  createdAt: Date;
  publishedAt: Date | null;
}) {
  return bookmark.createdAt;
}
