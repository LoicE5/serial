import { describe, expect, it, vi } from "vitest";
import type {
  ActiveFirstPageResult,
  OrganizationSnapshot,
  ReconciliationInput,
  ReconciliationRequestDescriptor,
  ReconciliationScopeTarget,
  ReconciliationStreamEvent,
} from "~/lib/reconciliation";
import type { NavigationSnapshot } from "~/server/navigation/snapshot";
import {
  createReconciliationRuntime,
  getReconciliationTargetKey,
} from "~/lib/reconciliation";
import { reconciliationInputSchema } from "~/server/reconciliation/input";

const ACTIVE_SCOPE: ReconciliationScopeTarget = {
  type: "scope",
  scope: { type: "view", viewId: 7 },
  contentStatus: { saveStatus: "inbox", archiveStatus: "unread" },
};

const ORGANIZATION: OrganizationSnapshot = {
  views: [],
  feeds: [],
  tags: [],
  feedTags: [],
  directViewFeeds: [],
  effectiveViewFeeds: [],
};

const PAGE: ActiveFirstPageResult = {
  target: ACTIVE_SCOPE,
  membershipRevision: 0,
  orderedRefs: [],
  feedItemDiffs: [],
  bookmarkDiffs: [],
  cursor: null,
  hasMore: false,
};

const NAVIGATION: NavigationSnapshot = {
  views: {},
  feeds: {},
  tags: {},
  viewFeeds: {},
};

function completeEpoch(reconciliationId: string): ReconciliationStreamEvent[] {
  return [
    {
      reconciliationId,
      chunk: { type: "organization-snapshot", snapshot: ORGANIZATION },
    },
    {
      reconciliationId,
      chunk: { type: "domain-complete", domain: "organization" },
    },
    {
      reconciliationId,
      chunk: { type: "active-first-page", page: PAGE },
    },
    {
      reconciliationId,
      chunk: {
        type: "domain-complete",
        domain: "active-scope",
        target: ACTIVE_SCOPE,
      },
    },
    {
      reconciliationId,
      chunk: { type: "navigation-snapshot", snapshot: NAVIGATION },
    },
    {
      reconciliationId,
      chunk: { type: "domain-complete", domain: "navigation" },
    },
    {
      reconciliationId,
      chunk: {
        type: "epoch-complete",
        requiredDomains: ["organization", "active-scope", "navigation"],
      },
    },
  ];
}

function harness(
  events: (
    request: ReconciliationRequestDescriptor,
  ) => ReconciliationStreamEvent[],
) {
  const requests: ReconciliationRequestDescriptor[] = [];
  const applications: string[] = [];
  const liveApplications: string[][] = [];
  let currentSelection: ReconciliationScopeTarget | null = null;
  let now = 0;
  const runtime = createReconciliationRuntime<string[]>({
    sessionId: () => "runtime-session",
    now: () => ++now,
    buildInput: (request) => {
      requests.push(request);
      return {
        type: "full",
        reconciliationId: request.reconciliationId,
        selection: {
          type: "cold",
          contentStatus: { saveStatus: "inbox", archiveStatus: "unread" },
          membershipRevision: 0,
        },
      } satisfies ReconciliationInput;
    },
    openStream: async (_input, signal) => ({
      async *[Symbol.asyncIterator]() {
        const request = requests.at(-1);
        if (!request) throw new Error("Expected a request");
        for (const event of events(request)) {
          if (signal.aborted) return;
          yield event;
        }
      },
    }),
    applyAuthoritative: (payload) => {
      applications.push(payload.type);
      return true;
    },
    applyLiveEvent: (payload) => {
      liveApplications.push(payload);
    },
    getCurrentSelection: () => currentSelection,
  });
  return {
    runtime,
    requests,
    applications,
    liveApplications,
    setSelection(selection: ReconciliationScopeTarget | null) {
      currentSelection = selection;
    },
  };
}

function hydrate(runtime: ReturnType<typeof harness>["runtime"]) {
  for (const domain of [
    "organization",
    "active-scope",
    "bookmarks",
    "navigation",
  ] as const) {
    runtime.hydrationComplete(domain);
  }
}

describe("client reconciliation runtime", () => {
  it("generates reconciliation IDs accepted by the RPC transport", () => {
    const test = harness(() => []);
    test.runtime.start();
    const request = test.runtime.getState().inFlight;
    expect(request).not.toBeNull();
    expect(
      reconciliationInputSchema.safeParse({
        type: "full",
        reconciliationId: request?.reconciliationId,
        selection: {
          type: "cold",
          contentStatus: { saveStatus: "inbox", archiveStatus: "unread" },
          membershipRevision: 0,
        },
      }).success,
    ).toBe(true);
  });

  it("starts cold, buffers complete domains through hydration, and establishes parity", async () => {
    const test = harness((request) => completeEpoch(request.reconciliationId));
    test.runtime.start();

    await vi.waitFor(() => expect(test.requests).toHaveLength(1));
    expect(test.requests[0]?.intent).toEqual({
      type: "full",
      coldContentStatus: { saveStatus: "inbox", archiveStatus: "unread" },
    });
    expect(test.applications).toEqual([]);

    test.runtime.cacheUsable();
    test.runtime.sseConnectionChanged(true);
    hydrate(test.runtime);

    await vi.waitFor(() =>
      expect(test.applications).toEqual([
        "organization",
        "active-scope",
        "navigation",
      ]),
    );
    expect(test.runtime.getState().trustedUpToDate).toBe(true);
    expect(
      test.runtime.getState().targets[getReconciliationTargetKey(ACTIVE_SCOPE)]
        ?.status,
    ).toBe("verified");
  });

  it("runs one follow-up full request when the first SSE connection is late", async () => {
    const test = harness((request) => completeEpoch(request.reconciliationId));
    hydrate(test.runtime);
    test.runtime.cacheUsable();
    test.runtime.start();
    await vi.waitFor(() =>
      expect(test.runtime.getState().serverParityAppliedAt).not.toBeNull(),
    );
    expect(test.requests).toHaveLength(1);

    test.setSelection(ACTIVE_SCOPE);
    test.runtime.sseConnectionChanged(true);
    await vi.waitFor(() => expect(test.requests).toHaveLength(2));
    expect(test.requests[1]?.intent).toEqual({
      type: "full",
      selectedScope: ACTIVE_SCOPE,
    });
  });

  it("does not request a verified scope again but full-reconciles after reconnect", async () => {
    const test = harness((request) => completeEpoch(request.reconciliationId));
    test.setSelection(ACTIVE_SCOPE);
    hydrate(test.runtime);
    test.runtime.cacheUsable();
    test.runtime.sseConnectionChanged(true);
    test.runtime.start();
    await vi.waitFor(() =>
      expect(test.runtime.getState().trustedUpToDate).toBe(true),
    );
    expect(test.requests).toHaveLength(1);

    test.runtime.activateScope(ACTIVE_SCOPE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(test.requests).toHaveLength(1);

    test.runtime.sseConnectionChanged(false);
    test.runtime.sseConnectionChanged(true);
    await vi.waitFor(() => expect(test.requests).toHaveLength(2));
    expect(test.requests[1]?.intent).toEqual({
      type: "full",
      selectedScope: ACTIVE_SCOPE,
    });
  });

  it("preserves completed domains and withholds parity after a terminal error", async () => {
    const test = harness((request) => [
      {
        reconciliationId: request.reconciliationId,
        chunk: { type: "organization-snapshot", snapshot: ORGANIZATION },
      },
      {
        reconciliationId: request.reconciliationId,
        chunk: { type: "domain-complete", domain: "organization" },
      },
      {
        reconciliationId: request.reconciliationId,
        chunk: {
          type: "domain-error",
          failure: {
            phase: "load-active-scope",
            domain: "active-scope",
            target: ACTIVE_SCOPE,
            message: "failed page",
          },
        },
      },
    ]);
    hydrate(test.runtime);
    test.runtime.cacheUsable();
    test.runtime.sseConnectionChanged(true);
    test.runtime.start();

    await vi.waitFor(() => expect(test.applications).toEqual(["organization"]));
    expect(test.runtime.getState().domains.organization.status).toBe(
      "verified",
    );
    expect(test.runtime.getState().domains["active-scope"].status).toBe(
      "dirty",
    );
    expect(test.runtime.getState().serverParityAppliedAt).toBeNull();
    expect(test.runtime.getState().trustedUpToDate).toBe(false);
  });

  it("buffers live events until their persisted domains hydrate", () => {
    const test = harness(() => []);
    test.runtime.receiveLiveEvent(["newer-live-state"]);
    expect(test.liveApplications).toEqual([]);

    test.runtime.hydrationComplete("organization");
    test.runtime.hydrationComplete("active-scope");
    expect(test.liveApplications).toEqual([]);
    test.runtime.hydrationComplete("bookmarks");
    expect(test.liveApplications).toEqual([["newer-live-state"]]);
  });
});
