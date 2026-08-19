"use client";

import { orpc, orpcRouterClient } from "../orpc";
import { getQueryClient } from "../query-client";
import { feedsStore } from "./feeds/store";
import {
  getFeedItemMembershipRevision,
  isFeedItemMembershipRevisionStale,
} from "./feed-items/membershipRevision";
import { loadingActor } from "./loading-machine";
import { applyRequestedMixedContentPage } from "./subscriptionCoordinator";
import { feedItemsStore } from "./store";
import type { ContentStatusFilter } from "~/lib/content-status";
import type { ImportProgressChunk } from "~/server/api/routers/initialRouter";

export function applyImportProgressChunk(chunk: ImportProgressChunk) {
  switch (chunk.type) {
    case "import-start":
      feedItemsStore.setState({ hasInitialData: true, feedStatusDict: {} });
      loadingActor.send({
        type: "IMPORT_START",
        totalFeeds: chunk.totalFeeds,
      });
      break;
    case "import-limit-warning":
      loadingActor.send({
        type: "IMPORT_LIMIT_WARNING",
        deactivatedCount: chunk.deactivatedCount,
        maxActiveFeeds: chunk.maxActiveFeeds,
      });
      break;
    case "import-feed-inserted":
      feedsStore.getState().add(chunk.feed);
      break;
    case "import-feed-error":
      console.error(`Import error for ${chunk.feedUrl}: ${chunk.error}`);
      loadingActor.send({ type: "IMPORT_FEED_ERROR", feedUrl: chunk.feedUrl });
      break;
    case "feed-status":
      feedItemsStore.setState({
        feedStatusDict: {
          ...feedItemsStore.getState().feedStatusDict,
          [chunk.feedId]: chunk.status,
        },
      });
      loadingActor.send({ type: "FEED_STATUS" });
      break;
  }
}

export const dataRequestActions = {
  requestMixedContentPage: (
    scope: Parameters<
      typeof orpcRouterClient.mixedContent.requestPage
    >[0]["scope"],
    contentStatus: ContentStatusFilter,
    cursor?: Parameters<
      typeof orpcRouterClient.mixedContent.requestPage
    >[0]["cursor"],
    limit?: number,
  ) => {
    const membershipRevision = getFeedItemMembershipRevision();
    return orpcRouterClient.mixedContent
      .requestPage({ scope, contentStatus, cursor, limit })
      .then((page) => {
        if (isFeedItemMembershipRevisionStale(membershipRevision)) return page;
        applyRequestedMixedContentPage({
          scope,
          contentStatus,
          page,
          replacesScope: !cursor,
        });
        return page;
      });
  },
  streamingImport: (
    feeds: Array<{
      feedUrl: string;
      categories: string[];
      categoryPaths?: Array<
        Array<{
          name: string;
          type?: "view" | "tag" | "feed";
          feedUrl?: string;
        }>
      >;
      tagNames?: string[];
    }>,
    importMode?: "tags" | "views" | "ignore",
  ) =>
    orpcRouterClient.initial
      .streamingImport({ feeds, importMode })
      .then(async (stream) => {
        try {
          for await (const chunk of stream) applyImportProgressChunk(chunk);
        } finally {
          loadingActor.send({ type: "IMPORT_COMPLETE" });
          await getQueryClient().invalidateQueries({
            queryKey: orpc.subscription.getStatus.queryOptions().queryKey,
          });
        }
      }),
};
