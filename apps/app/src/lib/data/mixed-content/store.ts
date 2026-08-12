import { createStore } from "zustand";
import { persist } from "zustand/middleware";
import {
  createFeedItemFilterIndex,
  createFeedItemFilterPredicate,
  getItemSectionPlacement,
  hasFeedItemListProjectionChanged,
} from "../feed-items/listProjection";
import { createNormalizedIDBStorage } from "../normalized-idb-storage";
import { createSelectorHooks } from "../createSelectorHooks";
import {
  bookmarkContentStatus,
  bookmarkReference,
  buildProjectionIndexes,
  canonicalize,
  collisionScopeKeys,
  emptyProjectionIndexes,
  getMixedScopeKey,
  isBookmarkProjectionChange,
  matchesScope,
  matchingLoadedScopeKeys,
  referenceRecordsEqual,
  referencesEqual,
  replaceScopeInIndexes,
  uniqueReferences,
  usesGlobalArchivedViewOrder,
} from "./bookmarkProjection";
import {
  filterSuppressedReferences,
  getMixedRetentionPins,
  getPersistedMixedContentState,
  mergeRetainedMixedPage,
  mixedReferenceKey,
  retainedMixedReferenceKeys,
  updateBookmarkPageMembership,
  updateReferencePageMembership,
} from "./page-retention";
import type { ProjectionIndexes } from "./bookmarkProjection";
import type {
  LoadedMixedScope,
  PersistedMixedContentState,
  SuppressedReferences,
} from "./page-retention";
import type {
  ApplicationFeedItem,
  ApplicationView,
  DatabaseFeedCategory,
} from "~/server/db/schema";
import type {
  ApplicationBookmark,
  MixedContentPage,
  MixedContentReference,
  MixedContentScope,
} from "~/server/mixed-content/projection";
import type { ContentStatusFilter } from "~/lib/content-status";
import {
  buildContentStatusKey,
  contentStatusFromScopeKey,
  selectContentStatusOrderValue,
  upgradeLegacyContentStatusScopeKey,
} from "~/lib/content-status";

export { getMixedScopeKey } from "./bookmarkProjection";
export type { LoadedMixedScope } from "./page-retention";

type MixedContentStore = {
  scopes: Record<string, LoadedMixedScope>;
  fetchingScopes: Record<string, boolean>;
  suppressedReferences: SuppressedReferences;
  projectionIndexes: ProjectionIndexes;
  projectionIndexesComplete: boolean;
  reset: () => void;
  setScopeFetching: (scopeKey: string, isFetching: boolean) => void;
  applyPage: (input: {
    scope: MixedContentScope;
    contentStatus: ContentStatusFilter;
    page: MixedContentPage;
    replacesScope: boolean;
    feedItems: Record<string, ApplicationFeedItem>;
  }) => void;
  reprojectUpsert: (input: {
    bookmark: ApplicationBookmark;
    previousBookmark: ApplicationBookmark | undefined;
    feedItems: Record<string, ApplicationFeedItem>;
    views: ApplicationView[];
  }) => LoadedMixedScope[];
  reprojectDeletion: (input: {
    bookmarkId: string;
    feedItems: Record<string, ApplicationFeedItem>;
  }) => LoadedMixedScope[];
  reprojectFeedItems: (input: {
    itemIds: string[];
    previousFeedItems?: Record<string, ApplicationFeedItem | undefined>;
    feedItems: Record<string, ApplicationFeedItem>;
    bookmarks: Record<string, ApplicationBookmark>;
    views: ApplicationView[];
    feedCategories: DatabaseFeedCategory[];
  }) => LoadedMixedScope[];
};

function feedItemReference(input: {
  item: ApplicationFeedItem;
  contentStatus: ContentStatusFilter;
  view: ApplicationView | null;
  filterIndex: ReturnType<typeof createFeedItemFilterIndex>;
}): MixedContentReference {
  const { item, contentStatus, view, filterIndex } = input;
  const normalizedAt = selectContentStatusOrderValue(contentStatus, {
    published: item.postedAt,
    saved: item.isWatchLaterUpdatedAt ?? item.postedAt,
    archived: item.isWatchedUpdatedAt ?? item.postedAt,
  });
  return {
    entityKind: "feed-item",
    entityId: item.id,
    sectionPlacement:
      view &&
      usesGlobalArchivedViewOrder(
        { type: "view", viewId: view.id },
        contentStatus,
      )
        ? null
        : (getItemSectionPlacement(item, view, filterIndex) ?? null),
    normalizedAt,
  };
}

function upgradeSuppressedReferenceScopeKeys(
  suppressedReferences: SuppressedReferences,
) {
  return Object.fromEntries(
    Object.entries(suppressedReferences).map(
      ([bookmarkId, referencesByScope]) => {
        const upgradedReferencesByScope: Record<
          string,
          MixedContentReference[]
        > = {};
        for (const [scopeKey, references] of Object.entries(
          referencesByScope,
        )) {
          const nextKey = upgradeLegacyContentStatusScopeKey(scopeKey);
          upgradedReferencesByScope[nextKey] = uniqueReferences([
            ...(upgradedReferencesByScope[nextKey] ?? []),
            ...references,
          ]);
        }
        return [bookmarkId, upgradedReferencesByScope];
      },
    ),
  );
}

const vanillaMixedContentStore = createStore<MixedContentStore>()(
  persist<MixedContentStore, [], [], PersistedMixedContentState>(
    (set, get) => ({
      scopes: {},
      fetchingScopes: {},
      suppressedReferences: {},
      projectionIndexes: emptyProjectionIndexes(),
      projectionIndexesComplete: true,
      reset: () =>
        set({
          scopes: {},
          fetchingScopes: {},
          suppressedReferences: {},
          projectionIndexes: emptyProjectionIndexes(),
          projectionIndexesComplete: true,
        }),
      setScopeFetching: (scopeKey, isFetching) =>
        set((state) => ({
          fetchingScopes: {
            ...state.fetchingScopes,
            [scopeKey]: isFetching,
          },
        })),
      applyPage: ({ scope, contentStatus, page, replacesScope, feedItems }) => {
        const key = getMixedScopeKey(scope, contentStatus);
        const current = get();
        const existing = current.scopes[key];
        const requestCursor = replacesScope ? null : existing?.cursor;
        const pages = mergeRetainedMixedPage({
          pages: existing?.pages ?? [],
          page,
          requestCursor,
          replacesScope,
        });
        const retainedKeys = retainedMixedReferenceKeys(pages);
        const pinnedEntityIds = getMixedRetentionPins();
        const nextScope = {
          scope,
          contentStatus,
          references: uniqueReferences(
            replacesScope
              ? page.references
              : [...(existing?.references ?? []), ...page.references],
            {
              usesGlobalEntityIdTieBreak: usesGlobalArchivedViewOrder(
                scope,
                contentStatus,
              ),
            },
          ).filter(
            (reference) =>
              retainedKeys.has(mixedReferenceKey(reference)) ||
              pinnedEntityIds.has(reference.entityId),
          ),
          pages,
          cursor: page.cursor,
          hasMore: page.hasMore,
        };
        const scopes = { ...current.scopes, [key]: nextScope };
        const projectionIndexes = current.projectionIndexesComplete
          ? current.projectionIndexes
          : buildProjectionIndexes(scopes, feedItems);
        if (current.projectionIndexesComplete) {
          replaceScopeInIndexes({
            indexes: projectionIndexes,
            scopeKey: key,
            previousReferences: existing?.references ?? [],
            nextReferences: nextScope.references,
            feedItems,
          });
        }
        set({
          scopes,
          suppressedReferences: filterSuppressedReferences(
            current.suppressedReferences,
            { [key]: retainedKeys },
            pinnedEntityIds,
          ),
          projectionIndexes,
          projectionIndexesComplete: true,
        });
      },
      reprojectUpsert: ({ bookmark, previousBookmark, feedItems, views }) => {
        if (!isBookmarkProjectionChange(previousBookmark, bookmark)) return [];

        const current = get();
        const projectionIndexes = current.projectionIndexesComplete
          ? current.projectionIndexes
          : buildProjectionIndexes(current.scopes, feedItems);
        const candidateKeys = new Set(
          projectionIndexes.bookmarkScopeKeys[bookmark.id] ?? [],
        );
        if (previousBookmark) {
          for (const key of matchingLoadedScopeKeys(
            previousBookmark,
            current.scopes,
            views,
          )) {
            candidateKeys.add(key);
          }
        }
        for (const key of matchingLoadedScopeKeys(
          bookmark,
          current.scopes,
          views,
        )) {
          candidateKeys.add(key);
        }

        const canonicalChanged =
          previousBookmark?.canonicalUrl !== bookmark.canonicalUrl;
        const previousSuppressed =
          current.suppressedReferences[bookmark.id] ?? {};
        const nextSuppressedForBookmark = canonicalChanged
          ? {}
          : { ...previousSuppressed };
        if (canonicalChanged) {
          for (const key of Object.keys(previousSuppressed)) {
            candidateKeys.add(key);
          }
          for (const key of collisionScopeKeys(
            bookmark.canonicalUrl,
            projectionIndexes,
          )) {
            candidateKeys.add(key);
          }
        }

        let scopes = current.scopes;
        const affected: LoadedMixedScope[] = [];
        for (const key of candidateKeys) {
          const scopeState = current.scopes[key];
          if (!scopeState) continue;
          let references = scopeState.references.filter(
            (reference) =>
              reference.entityKind !== "bookmark" ||
              reference.entityId !== bookmark.id,
          );
          if (canonicalChanged) {
            references = uniqueReferences([
              ...references,
              ...(previousSuppressed[key] ?? []),
            ]);
          }

          const newlySuppressed = references.filter((reference) => {
            if (reference.entityKind !== "feed-item") return false;
            const item = feedItems[reference.entityId];
            return item?.url
              ? canonicalize(item.url) === bookmark.canonicalUrl
              : false;
          });
          if (newlySuppressed.length > 0) {
            nextSuppressedForBookmark[key] = uniqueReferences([
              ...(nextSuppressedForBookmark[key] ?? []),
              ...newlySuppressed,
            ]);
          }
          const newlySuppressedIds = new Set(
            newlySuppressed.map((reference) => reference.entityId),
          );
          references = references.filter(
            (reference) =>
              reference.entityKind !== "feed-item" ||
              !newlySuppressedIds.has(reference.entityId),
          );
          if (
            buildContentStatusKey(bookmarkContentStatus(bookmark)) ===
              buildContentStatusKey(scopeState.contentStatus) &&
            matchesScope(bookmark, scopeState.scope, views)
          ) {
            references = [
              ...references,
              bookmarkReference(bookmark, scopeState, views),
            ];
          }
          references = uniqueReferences(references, {
            usesGlobalEntityIdTieBreak: usesGlobalArchivedViewOrder(
              scopeState.scope,
              scopeState.contentStatus,
            ),
          });
          if (referencesEqual(scopeState.references, references)) continue;

          const nextScope = {
            ...scopeState,
            references,
            pages: updateBookmarkPageMembership(
              scopeState.pages,
              bookmark.id,
              references.some(
                (reference) =>
                  reference.entityKind === "bookmark" &&
                  reference.entityId === bookmark.id,
              ),
            ),
          };
          if (scopes === current.scopes) scopes = { ...current.scopes };
          scopes[key] = nextScope;
          replaceScopeInIndexes({
            indexes: projectionIndexes,
            scopeKey: key,
            previousReferences: scopeState.references,
            nextReferences: references,
            feedItems,
          });
          affected.push(nextScope);
        }

        const suppressedReferences = { ...current.suppressedReferences };
        if (Object.keys(nextSuppressedForBookmark).length > 0) {
          suppressedReferences[bookmark.id] = nextSuppressedForBookmark;
        } else {
          delete suppressedReferences[bookmark.id];
        }
        const suppressionChanged = !referenceRecordsEqual(
          previousSuppressed,
          nextSuppressedForBookmark,
        );
        if (
          affected.length > 0 ||
          suppressionChanged ||
          !current.projectionIndexesComplete
        ) {
          set({
            scopes,
            suppressedReferences,
            projectionIndexes,
            projectionIndexesComplete: true,
          });
        }
        return affected;
      },
      reprojectDeletion: ({ bookmarkId, feedItems }) => {
        const current = get();
        const projectionIndexes = current.projectionIndexesComplete
          ? current.projectionIndexes
          : buildProjectionIndexes(current.scopes, feedItems);
        const hadSuppressedReferences =
          current.suppressedReferences[bookmarkId] !== undefined;
        const suppressedForBookmark =
          current.suppressedReferences[bookmarkId] ?? {};
        const candidateKeys = new Set([
          ...(projectionIndexes.bookmarkScopeKeys[bookmarkId] ?? []),
          ...Object.keys(suppressedForBookmark),
        ]);
        let scopes = current.scopes;
        const affected: LoadedMixedScope[] = [];
        for (const key of candidateKeys) {
          const scopeState = current.scopes[key];
          if (!scopeState) continue;
          const references = uniqueReferences(
            [
              ...scopeState.references.filter(
                (reference) =>
                  reference.entityKind !== "bookmark" ||
                  reference.entityId !== bookmarkId,
              ),
              ...(suppressedForBookmark[key] ?? []),
            ],
            {
              usesGlobalEntityIdTieBreak: usesGlobalArchivedViewOrder(
                scopeState.scope,
                scopeState.contentStatus,
              ),
            },
          );
          if (referencesEqual(scopeState.references, references)) continue;

          const nextScope = {
            ...scopeState,
            references,
            pages: updateBookmarkPageMembership(
              scopeState.pages,
              bookmarkId,
              false,
            ),
          };
          if (scopes === current.scopes) scopes = { ...current.scopes };
          scopes[key] = nextScope;
          replaceScopeInIndexes({
            indexes: projectionIndexes,
            scopeKey: key,
            previousReferences: scopeState.references,
            nextReferences: references,
            feedItems,
          });
          affected.push(nextScope);
        }
        const { [bookmarkId]: _removed, ...suppressedReferences } =
          current.suppressedReferences;
        void _removed;
        if (
          affected.length > 0 ||
          hadSuppressedReferences ||
          !current.projectionIndexesComplete
        ) {
          set({
            scopes,
            suppressedReferences,
            projectionIndexes,
            projectionIndexesComplete: true,
          });
        }
        return affected;
      },
      reprojectFeedItems: ({
        itemIds,
        previousFeedItems = {},
        feedItems,
        bookmarks,
        views,
        feedCategories,
      }) => {
        const changedItemIds = [...new Set(itemIds)].filter((itemId) => {
          const item = feedItems[itemId];
          return (
            item !== undefined &&
            hasFeedItemListProjectionChanged(previousFeedItems[itemId], item)
          );
        });
        if (changedItemIds.length === 0) return [];

        const current = get();
        const filterIndex = createFeedItemFilterIndex(feedCategories, views);
        const viewsById = new Map(views.map((view) => [view.id, view]));
        const bookmarkByCanonical = new Map(
          Object.values(bookmarks).map((bookmark) => [
            canonicalize(bookmark.canonicalUrl),
            bookmark,
          ]),
        );
        const projectionIndexes = current.projectionIndexesComplete
          ? current.projectionIndexes
          : buildProjectionIndexes(current.scopes, feedItems);
        let scopes = current.scopes;
        let suppressedReferences = current.suppressedReferences;
        const affected: LoadedMixedScope[] = [];

        for (const [scopeKey, scopeState] of Object.entries(current.scopes)) {
          const scope = scopeState.scope;
          const view =
            scope.type === "view"
              ? (viewsById.get(scope.viewId) ?? null)
              : null;
          if (scope.type === "view" && !view) continue;
          const doesItemBelongToScope = createFeedItemFilterPredicate({
            contentStatusFilter: scopeState.contentStatus,
            categoryFilter: scope.type === "tag" ? scope.tagId : -1,
            feedFilter: -1,
            viewFilter: view,
            filterIndex,
          });
          let references = scopeState.references;
          let pages = scopeState.pages;

          for (const itemId of changedItemIds) {
            const item = feedItems[itemId];
            if (!item) continue;
            const nextReference = feedItemReference({
              item,
              contentStatus: scopeState.contentStatus,
              view,
              filterIndex,
            });
            const belongs = doesItemBelongToScope(item);
            const collisionBookmark = bookmarkByCanonical.get(
              canonicalize(item.url),
            );

            references = references.filter(
              (reference) =>
                reference.entityKind !== "feed-item" ||
                reference.entityId !== itemId,
            );
            pages = updateReferencePageMembership(
              pages,
              nextReference,
              belongs,
            );

            let nextSuppressed = suppressedReferences;
            for (const [bookmarkId, referencesByScope] of Object.entries(
              suppressedReferences,
            )) {
              const scopedReferences = referencesByScope[scopeKey];
              if (
                !scopedReferences?.some(
                  (reference) =>
                    reference.entityKind === "feed-item" &&
                    reference.entityId === itemId,
                )
              ) {
                continue;
              }
              if (nextSuppressed === suppressedReferences) {
                nextSuppressed = { ...suppressedReferences };
              }
              const nextReferencesByScope = { ...referencesByScope };
              const remaining = scopedReferences.filter(
                (reference) =>
                  reference.entityKind !== "feed-item" ||
                  reference.entityId !== itemId,
              );
              if (remaining.length > 0) {
                nextReferencesByScope[scopeKey] = remaining;
              } else {
                delete nextReferencesByScope[scopeKey];
              }
              if (Object.keys(nextReferencesByScope).length > 0) {
                nextSuppressed[bookmarkId] = nextReferencesByScope;
              } else {
                delete nextSuppressed[bookmarkId];
              }
            }
            suppressedReferences = nextSuppressed;

            if (belongs && collisionBookmark) {
              const referencesByScope =
                suppressedReferences[collisionBookmark.id] ?? {};
              suppressedReferences = {
                ...suppressedReferences,
                [collisionBookmark.id]: {
                  ...referencesByScope,
                  [scopeKey]: uniqueReferences([
                    ...(referencesByScope[scopeKey] ?? []),
                    nextReference,
                  ]),
                },
              };
            } else if (belongs) {
              references = [...references, nextReference];
            }
          }

          references = uniqueReferences(references, {
            usesGlobalEntityIdTieBreak: usesGlobalArchivedViewOrder(
              scopeState.scope,
              scopeState.contentStatus,
            ),
          });
          if (
            referencesEqual(scopeState.references, references) &&
            pages === scopeState.pages
          ) {
            continue;
          }
          const nextScope = { ...scopeState, references, pages };
          if (scopes === current.scopes) scopes = { ...current.scopes };
          scopes[scopeKey] = nextScope;
          replaceScopeInIndexes({
            indexes: projectionIndexes,
            scopeKey,
            previousReferences: scopeState.references,
            nextReferences: references,
            feedItems,
          });
          affected.push(nextScope);
        }

        if (
          affected.length > 0 ||
          suppressedReferences !== current.suppressedReferences ||
          !current.projectionIndexesComplete
        ) {
          set({
            scopes,
            suppressedReferences,
            projectionIndexes,
            projectionIndexesComplete: true,
          });
        }
        return affected;
      },
    }),
    {
      name: "serial-mixed-content-store-v2",
      storage: createNormalizedIDBStorage({
        recordFields: ["scopes", "suppressedReferences"],
      }),
      partialize: getPersistedMixedContentState,
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<MixedContentStore>;
        const scopes = Object.fromEntries(
          Object.entries(persisted?.scopes ?? {}).flatMap(([key, scope]) => {
            const contentStatus = contentStatusFromScopeKey(key);
            if (!contentStatus) return [];
            return [
              [
                getMixedScopeKey(scope.scope, contentStatus),
                { ...scope, contentStatus, pages: scope.pages ?? [] },
              ],
            ];
          }),
        );
        const suppressedReferences = upgradeSuppressedReferenceScopeKeys(
          persisted?.suppressedReferences ?? {},
        );
        return {
          ...currentState,
          ...(persisted ?? {}),
          scopes,
          suppressedReferences,
          projectionIndexes: emptyProjectionIndexes(),
          projectionIndexesComplete: Object.keys(scopes).length === 0,
        };
      },
    },
  ),
);

export const mixedContentStore = createSelectorHooks(vanillaMixedContentStore);
