export function getBookmarkPostedAt(bookmark: {
  createdAt: Date;
  publishedAt: Date | null;
}) {
  return bookmark.publishedAt ?? bookmark.createdAt;
}
