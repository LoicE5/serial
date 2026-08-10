import {
  createReconciliationCoordinatorState,
  transitionReconciliation,
} from "./coordinator";
import { getReconciliationTargetKey } from "./contracts";
import type {
  ReconciliationCommand,
  ReconciliationCoordinatorEvent,
  ReconciliationCoordinatorState,
  ReconciliationRequestDescriptor,
} from "./coordinator";
import type {
  ActiveFirstPageResult,
  OrganizationSnapshot,
  ReconciliationHydrationDomain,
  ReconciliationInput,
  ReconciliationScopeTarget,
  ReconciliationStreamEvent,
  ReconciliationTarget,
  RequiredReconciliationDomain,
} from "./contracts";
import type { NavigationSnapshot } from "~/server/navigation/snapshot";

export type ReconciliationAuthoritativePayload =
  | { type: "organization"; snapshot: OrganizationSnapshot }
  | { type: "active-scope"; page: ActiveFirstPageResult }
  | { type: "navigation"; snapshot: NavigationSnapshot };

export type ReconciliationRuntimeDependencies<TLiveEvent> = {
  sessionId: () => string;
  now: () => number;
  buildInput: (request: ReconciliationRequestDescriptor) => ReconciliationInput;
  openStream: (
    input: ReconciliationInput,
    signal: AbortSignal,
  ) => Promise<AsyncIterable<ReconciliationStreamEvent>>;
  applyAuthoritative: (payload: ReconciliationAuthoritativePayload) => boolean;
  applyLiveEvent: (payload: TLiveEvent) => ReconciliationTarget[] | void;
  getCurrentSelection: () => ReconciliationScopeTarget | null;
  mark?: (name: string, reconciliationId?: string) => void;
  onParityApplied?: () => void;
};

export type ReconciliationRuntime<TLiveEvent> = ReturnType<
  typeof createReconciliationRuntime<TLiveEvent>
>;

function failureTarget(
  event: Extract<ReconciliationStreamEvent["chunk"], { type: "domain-error" }>,
): ReconciliationTarget | undefined {
  if (event.failure.target) return event.failure.target;
  if (event.failure.domain === "organization") return { type: "organization" };
  if (event.failure.domain === "navigation") return { type: "navigation" };
  return undefined;
}

function hydrationFor(payload: ReconciliationAuthoritativePayload) {
  switch (payload.type) {
    case "organization":
      return ["organization"] as ReconciliationHydrationDomain[];
    case "active-scope":
      return [
        "organization",
        "active-scope",
        "bookmarks",
      ] as ReconciliationHydrationDomain[];
    case "navigation":
      return ["organization", "navigation"] as ReconciliationHydrationDomain[];
  }
}

export function createReconciliationRuntime<TLiveEvent>(
  dependencies: ReconciliationRuntimeDependencies<TLiveEvent>,
) {
  type State = ReconciliationCoordinatorState<
    ReconciliationAuthoritativePayload,
    TLiveEvent
  >;
  type Event = ReconciliationCoordinatorEvent<
    ReconciliationAuthoritativePayload,
    TLiveEvent
  >;
  type Command = ReconciliationCommand<
    ReconciliationAuthoritativePayload,
    TLiveEvent
  >;

  let state: State = createReconciliationCoordinatorState(
    dependencies.sessionId(),
  );
  let started = false;
  let everConnected = false;
  let reconnectRequired = false;
  let completedBeforeFirstConnection = false;
  let liveSequence = 0;
  const listeners = new Set<() => void>();
  const requestControllers = new Map<string, AbortController>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const execute = (commands: Command[]) => {
    for (const command of commands) {
      if (command.type === "start-reconciliation") {
        dependencies.mark?.(
          "serial:reconciliation-requested",
          command.request.reconciliationId,
        );
        const controller = new AbortController();
        requestControllers.set(command.request.reconciliationId, controller);
        void runRequest(command.request, controller.signal);
        continue;
      }
      if (command.type === "apply-live-event") {
        const invalidatedTargets = dependencies.applyLiveEvent(command.payload);
        if (invalidatedTargets && invalidatedTargets.length > 0) {
          send({
            type: "live-event-received",
            eventId: `applied:${command.eventId}`,
            targets: invalidatedTargets,
            invalidates: invalidatedTargets,
            requiresHydration: [],
          });
        }
        continue;
      }
      const applied = dependencies.applyAuthoritative(command.payload);
      if (applied) {
        send({
          type: "authoritative-applied",
          reconciliationId: command.reconciliationId,
          target: command.target,
          at: dependencies.now(),
        });
      } else {
        send({
          type: "live-event-received",
          eventId: `rejected-authority:${command.reconciliationId}`,
          targets: [command.target],
          invalidates: [command.target],
          requiresHydration: [],
        });
      }
    }
  };

  const send = (event: Event) => {
    const previousParity = state.serverParityAppliedAt;
    const transition = transitionReconciliation(state, event);
    state = transition.state;
    notify();
    if (
      previousParity !== state.serverParityAppliedAt &&
      state.serverParityAppliedAt !== null
    ) {
      dependencies.mark?.(
        "serial:server-parity-applied",
        state.latestFullEpoch?.reconciliationId,
      );
      dependencies.onParityApplied?.();
    }
    execute(transition.commands);
  };

  const applyCompletedDomain = (
    reconciliationId: string,
    domain: RequiredReconciliationDomain,
    pending: Partial<
      Record<RequiredReconciliationDomain, ReconciliationAuthoritativePayload>
    >,
  ) => {
    const payload = pending[domain];
    if (!payload) return;
    delete pending[domain];
    const target: ReconciliationTarget =
      payload.type === "active-scope"
        ? payload.page.target
        : { type: payload.type };
    dependencies.mark?.(
      `serial:reconciliation-${domain}-received`,
      reconciliationId,
    );
    send({
      type: "authoritative-received",
      reconciliationId,
      target,
      requiresHydration: hydrationFor(payload),
      payload,
    });
  };

  async function runRequest(
    request: ReconciliationRequestDescriptor,
    signal: AbortSignal,
  ) {
    const pending: Partial<
      Record<RequiredReconciliationDomain, ReconciliationAuthoritativePayload>
    > = {};
    let settled = false;
    try {
      const input = dependencies.buildInput(request);
      const stream = await dependencies.openStream(input, signal);
      for await (const event of stream) {
        if (signal.aborted) return;
        if (event.reconciliationId !== request.reconciliationId) continue;
        const { chunk } = event;
        switch (chunk.type) {
          case "organization-snapshot":
            pending.organization = {
              type: "organization",
              snapshot: chunk.snapshot,
            };
            break;
          case "active-first-page":
            pending["active-scope"] = {
              type: "active-scope",
              page: chunk.page,
            };
            break;
          case "navigation-snapshot":
            pending.navigation = {
              type: "navigation",
              snapshot: chunk.snapshot,
            };
            break;
          case "domain-complete":
            applyCompletedDomain(
              request.reconciliationId,
              chunk.domain,
              pending,
            );
            break;
          case "automatic-rss-owner":
            send({
              type: "automatic-rss-owner-resolved",
              owner: chunk.owner,
            });
            break;
          case "domain-error": {
            const target = failureTarget(chunk);
            if (!state.sseConnected && !everConnected) {
              completedBeforeFirstConnection = true;
            }
            send({
              type: "request-settled",
              reconciliationId: request.reconciliationId,
              at: dependencies.now(),
              failed: true,
              failedTargets: target ? [target] : undefined,
            });
            settled = true;
            return;
          }
          case "epoch-complete":
            if (!state.sseConnected && !everConnected) {
              completedBeforeFirstConnection = true;
            }
            send({
              type: "request-settled",
              reconciliationId: request.reconciliationId,
              at: dependencies.now(),
            });
            settled = true;
            return;
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        console.error("Reconciliation request failed", error);
      }
    } finally {
      requestControllers.delete(request.reconciliationId);
      if (!settled && !signal.aborted) {
        if (!state.sseConnected && !everConnected) {
          completedBeforeFirstConnection = true;
        }
        const failedTargets = state.requests[request.reconciliationId]?.targets;
        send({
          type: "request-settled",
          reconciliationId: request.reconciliationId,
          at: dependencies.now(),
          failed: true,
          failedTargets,
        });
      }
    }
  }

  const requestCurrentFull = () => {
    const selectedScope = dependencies.getCurrentSelection();
    send({
      type: "request-reconciliation",
      intent: selectedScope
        ? { type: "full", selectedScope }
        : {
            type: "full",
            coldContentStatus: { saveStatus: "inbox", archiveStatus: "unread" },
          },
    });
  };

  return {
    start() {
      if (started) return;
      started = true;
      requestCurrentFull();
    },
    stop() {
      for (const controller of requestControllers.values()) controller.abort();
      requestControllers.clear();
      started = false;
      everConnected = false;
      reconnectRequired = false;
      completedBeforeFirstConnection = false;
      state = createReconciliationCoordinatorState(dependencies.sessionId());
      notify();
    },
    cacheUsable() {
      send({ type: "cache-usable", at: dependencies.now() });
      dependencies.mark?.("serial:cache-usable");
    },
    hydrationComplete(domain: ReconciliationHydrationDomain) {
      send({ type: "hydration-complete", domain });
    },
    sseConnectionChanged(connected: boolean) {
      const wasConnected = state.sseConnected;
      send({ type: "sse-connection-changed", connected });
      if (!connected) {
        if (wasConnected) reconnectRequired = true;
        return;
      }
      dependencies.mark?.("serial:subscription-connected");
      if (
        reconnectRequired ||
        (!everConnected && completedBeforeFirstConnection)
      ) {
        reconnectRequired = false;
        completedBeforeFirstConnection = false;
        requestCurrentFull();
      }
      everConnected = true;
    },
    activateScope(target: ReconciliationScopeTarget) {
      const targetState = state.targets[getReconciliationTargetKey(target)];
      if (
        targetState?.status === "verified" ||
        targetState?.status === "syncing"
      ) {
        return;
      }
      send({
        type: "request-reconciliation",
        intent: { type: "targeted", targets: [target] },
      });
    },
    receiveLiveEvent(payload: TLiveEvent) {
      const inFlightFull = state.inFlight?.intent.type === "full";
      const selectedScope = dependencies.getCurrentSelection();
      const invalidates = inFlightFull
        ? ([
            { type: "organization" },
            ...(selectedScope ? [selectedScope] : []),
            { type: "navigation" },
          ] as ReconciliationTarget[])
        : undefined;
      send({
        type: "live-event-received",
        eventId: `live:${++liveSequence}`,
        targets: selectedScope ? [selectedScope] : [],
        requiresHydration: ["organization", "active-scope", "bookmarks"],
        payload,
        invalidates,
      });
    },
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
