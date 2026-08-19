import { afterEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  createLocalBenchmarkTarget,
  openBenchmarkDatabase,
} from "../../../scripts/performance/database";
import { seedBenchmarkFixture } from "../../../scripts/performance/fixtures";
import { reconcileApplicationState } from "~/server/reconciliation";

type Session = ReturnType<typeof openBenchmarkDatabase>;
type Target = ReturnType<typeof createLocalBenchmarkTarget>;

const sessions: Session[] = [];
const targets: Target[] = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.close();
  for (const target of targets.splice(0)) target.cleanup();
});

describe("View first-page matrix performance bounds", () => {
  it("keeps the deterministic 26-View matrix bounded and de-duplicates entities", async () => {
    const target = createLocalBenchmarkTarget();
    const session = openBenchmarkDatabase({ url: target.url });
    targets.push(target);
    sessions.push(session);
    await applyMigrations(session.baseClient);
    await seedBenchmarkFixture({
      database: session.database,
      profileName: "stress",
      userId: "view-matrix-stress",
    });

    const events = [];
    for await (const event of reconcileApplicationState({
      database: session.database,
      userId: "view-matrix-stress",
      request: {
        type: "full",
        reconciliationId: "view-matrix-stress",
        selection: {
          type: "cold",
          contentStatus: { saveStatus: "inbox", archiveStatus: "unread" },
          membershipRevision: 7,
        },
      },
    })) {
      events.push(event);
    }

    const pages = events.flatMap(({ chunk }) =>
      chunk.type === "active-first-page" ? [chunk.page] : [],
    );
    const targetKeys = pages.map(({ target: pageTarget }) => {
      if (pageTarget.scope.type !== "view") return "non-view";
      return `${pageTarget.scope.viewId}:${pageTarget.contentStatus.saveStatus}:${pageTarget.contentStatus.archiveStatus}`;
    });
    const upsertKeys = pages.flatMap((page) => [
      ...page.feedItemDiffs.flatMap((diff) =>
        diff.status === "upsert" ? [`feed-item:${diff.entity.id}`] : [],
      ),
      ...page.bookmarkDiffs.flatMap((diff) =>
        diff.status === "upsert" ? [`bookmark:${diff.entity.id}`] : [],
      ),
    ]);

    expect(pages).toHaveLength(104);
    expect(new Set(targetKeys).size).toBe(104);
    expect(pages.every((page) => page.orderedRefs.length <= 30)).toBe(true);
    expect(
      pages.reduce((count, page) => count + page.orderedRefs.length, 0),
    ).toBeLessThanOrEqual(3_120);
    expect(pages.every((page) => page.membershipRevision === 7)).toBe(true);
    expect(new Set(upsertKeys).size).toBe(upsertKeys.length);
    expect(
      Math.max(
        ...events.map((event) => Buffer.byteLength(JSON.stringify(event))),
      ),
    ).toBeLessThanOrEqual(512 * 1_024);
    expect(Buffer.byteLength(JSON.stringify(events))).toBeLessThanOrEqual(
      32 * 1_024 * 1_024,
    );
  }, 60_000);
});
