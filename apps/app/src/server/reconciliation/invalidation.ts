import type { ReconciliationInvalidationSummary } from "~/lib/reconciliation";
import { getUserChannel } from "~/server/api/channels";
import { publisher } from "~/server/api/publisher";

export function publishReconciliationInvalidation(
  userId: string,
  summary: ReconciliationInvalidationSummary,
) {
  return publisher.publish(getUserChannel(userId), {
    source: "invalidation",
    chunk: summary,
  });
}

export function organizationInvalidationSummary(
  input: {
    scopes?: ReconciliationInvalidationSummary["scopeImpact"];
  } = {},
): ReconciliationInvalidationSummary {
  return {
    type: "reconciliation-invalidation",
    domains: ["organization", "navigation"],
    scopeImpact: input.scopes ?? {
      type: "known",
      selectors: [
        {
          type: "all-retained",
          contentStatusKeys: [
            "inbox:unread",
            "inbox:archived",
            "saved:unread",
            "saved:archived",
          ],
        },
      ],
    },
  };
}
