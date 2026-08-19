import { loadApplicationBookmarksById } from "./projection";
import type { ApplicationBookmark } from "./projection";
import type { db as defaultDatabase } from "~/server/db";
import type { ContentStatusKey } from "~/lib/content-status";
import type {
  BookmarkInvalidationState,
  ReconciliationInvalidationSummary,
} from "~/lib/reconciliation";
import { getUserChannel } from "~/server/api/channels";
import { publisher } from "~/server/api/publisher";
import { buildBookmarkInvalidationSummary } from "~/lib/reconciliation";

type MixedContentDatabase = typeof defaultDatabase;

export type BookmarkPublishedChunk =
  | {
      type: "bookmark-upsert";
      bookmark: ApplicationBookmark;
      affectsListProjection?: boolean;
    }
  | { type: "bookmark-upsert-batch"; bookmarks: ApplicationBookmark[] }
  | { type: "bookmark-delete"; id: string; canonicalUrl: string };

export async function loadApplicationBookmark(input: {
  database: MixedContentDatabase;
  userId: string;
  bookmarkId: string;
}) {
  const bookmarks = await loadApplicationBookmarksById({
    ...input,
    bookmarkIds: [input.bookmarkId],
  });
  return bookmarks.find((bookmark) => bookmark.id === input.bookmarkId) ?? null;
}

export async function publishBookmarkUpsert(input: {
  database: MixedContentDatabase;
  userId: string;
  bookmarkId: string;
  previousBookmark?: BookmarkInvalidationState | null;
  contentStatusKeys?: ContentStatusKey[];
  invalidation?: ReconciliationInvalidationSummary;
  affectsListProjection?: boolean;
}) {
  const bookmark = await loadApplicationBookmark(input);
  if (!bookmark) return null;
  await publisher.publish(getUserChannel(input.userId), {
    source: "bookmark",
    chunk: {
      type: "bookmark-upsert",
      bookmark,
      affectsListProjection: input.affectsListProjection,
    },
    invalidation:
      input.invalidation ??
      buildBookmarkInvalidationSummary({
        before: input.previousBookmark,
        after: bookmark,
        contentStatusKeys: input.contentStatusKeys,
      }),
  });
  return bookmark;
}

export async function publishBookmarkUpsertBatch(input: {
  userId: string;
  bookmarks: ApplicationBookmark[];
  previousBookmarks?: BookmarkInvalidationState[];
  contentStatusKeys?: ContentStatusKey[];
}) {
  const invalidation = buildBookmarkInvalidationSummary({
    states: [...(input.previousBookmarks ?? []), ...input.bookmarks],
    contentStatusKeys: input.contentStatusKeys,
  });
  for (let index = 0; index < input.bookmarks.length; index += 50) {
    // Each event is bounded so publisher and SSE buffers cannot accumulate a
    // single library-sized payload.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await publisher.publish(getUserChannel(input.userId), {
      source: "bookmark",
      chunk: {
        type: "bookmark-upsert-batch",
        bookmarks: input.bookmarks.slice(index, index + 50),
      },
      invalidation: index === 0 ? invalidation : undefined,
    });
  }
}

export async function publishBookmarkDeletion(input: {
  userId: string;
  id: string;
  canonicalUrl: string;
  bookmark?: BookmarkInvalidationState;
  invalidation?: ReconciliationInvalidationSummary;
}) {
  await publisher.publish(getUserChannel(input.userId), {
    source: "bookmark",
    chunk: {
      type: "bookmark-delete",
      id: input.id,
      canonicalUrl: input.canonicalUrl,
    },
    invalidation:
      input.invalidation ??
      (input.bookmark
        ? buildBookmarkInvalidationSummary({ before: input.bookmark })
        : {
            type: "reconciliation-invalidation" as const,
            domains: ["navigation" as const],
            scopeImpact: { type: "unknown" as const },
          }),
  });
}

export function publishBookmarkConsolidationDeletions(input: {
  userId: string;
  bookmarkIds: string[];
  canonicalUrl: string;
}) {
  return Promise.all(
    input.bookmarkIds.map((bookmarkId) =>
      publishBookmarkDeletion({
        userId: input.userId,
        id: bookmarkId,
        canonicalUrl: input.canonicalUrl,
      }),
    ),
  );
}
