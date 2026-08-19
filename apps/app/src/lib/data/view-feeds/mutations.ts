import { useMutation } from "@tanstack/react-query";
import { useFetchViews } from "../views/store";
import { useFetchViewFeeds } from "./store";
import { orpc } from "~/lib/orpc";
import { refreshNavigationSnapshotSafely } from "~/lib/data/navigation/store";

export function useBulkAssignViewFeedMutation() {
  const fetchViewFeeds = useFetchViewFeeds();
  const fetchViews = useFetchViews();

  return useMutation(
    orpc.viewFeeds.bulkAssignToView.mutationOptions({
      onSuccess: async () => {
        await Promise.all([fetchViewFeeds(), fetchViews()]);
        await refreshNavigationSnapshotSafely();
      },
    }),
  );
}

export function useBulkRemoveViewFeedMutation() {
  const fetchViewFeeds = useFetchViewFeeds();
  const fetchViews = useFetchViews();

  return useMutation(
    orpc.viewFeeds.bulkRemoveFromView.mutationOptions({
      onSuccess: async () => {
        await Promise.all([fetchViewFeeds(), fetchViews()]);
        await refreshNavigationSnapshotSafely();
      },
    }),
  );
}
