import { afterEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  createLocalBenchmarkTarget,
  openBenchmarkDatabase,
} from "../../../scripts/performance/database";
import { seedBenchmarkFixture } from "../../../scripts/performance/fixtures";
import type { BenchmarkProfileName } from "../../../scripts/performance/model";
import { queryNavigationSnapshot } from "~/server/navigation/snapshot";

type Session = ReturnType<typeof openBenchmarkDatabase>;
type Target = ReturnType<typeof createLocalBenchmarkTarget>;

const sessions: Session[] = [];
const targets: Target[] = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.close();
  for (const target of targets.splice(0)) target.cleanup();
});

describe("navigation snapshot performance bounds", () => {
  it("does not materialize the removed View availability projection", async () => {
    const target = createLocalBenchmarkTarget();
    const session = openBenchmarkDatabase({ url: target.url });
    targets.push(target);
    sessions.push(session);
    await applyMigrations(session.baseClient);
    await seedBenchmarkFixture({
      database: session.database,
      profileName: "small",
      userId: "navigation-plan",
    });

    session.instrumentation.reset();
    await queryNavigationSnapshot({
      database: session.database,
      userId: "navigation-plan",
    });
    const evidence = session.instrumentation.snapshot();

    expect(evidence.statementCount).toBe(5);
    expect(
      evidence.statements.some(({ sql }) =>
        sql.includes("serial_bookmark_view"),
      ),
    ).toBe(false);
  });

  it.each<BenchmarkProfileName>(["small", "representative", "stress"])(
    "materializes only navigation entities for the %s library",
    async (profileName) => {
      const target = createLocalBenchmarkTarget();
      const session = openBenchmarkDatabase({ url: target.url });
      targets.push(target);
      sessions.push(session);
      await applyMigrations(session.baseClient);
      await seedBenchmarkFixture({
        database: session.database,
        profileName,
        userId: `navigation-${profileName}`,
      });

      session.instrumentation.reset();
      const snapshot = await queryNavigationSnapshot({
        database: session.database,
        userId: `navigation-${profileName}`,
      });
      const evidence = session.instrumentation.snapshot();
      const navigationEntityCount =
        Object.keys(snapshot.tags).length + Object.keys(snapshot.feeds).length;
      const customViewCount = Math.max(
        0,
        Object.keys(snapshot.viewFeeds).length - 1,
      );
      const viewFeedMembershipCount = Object.values(snapshot.viewFeeds).reduce(
        (count, feedAvailability) =>
          count + Object.keys(feedAvailability).length,
        0,
      );

      expect(evidence.statementCount).toBe(5);
      expect(evidence.materializedRows).toBe(
        navigationEntityCount + customViewCount + viewFeedMembershipCount,
      );
      expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(
        (navigationEntityCount + viewFeedMembershipCount) * 128,
      );
    },
    30_000,
  );

  it("keeps all-Feed membership with empty read and Saved statuses bounded", async () => {
    const target = createLocalBenchmarkTarget();
    const session = openBenchmarkDatabase({ url: target.url });
    targets.push(target);
    sessions.push(session);
    await applyMigrations(session.baseClient);
    await seedBenchmarkFixture({
      database: session.database,
      profileName: "stress",
      userId: "navigation-adversarial",
      navigationShape: "all-memberships-unread",
    });

    session.instrumentation.reset();
    const snapshot = await queryNavigationSnapshot({
      database: session.database,
      userId: "navigation-adversarial",
    });
    const evidence = session.instrumentation.snapshot();

    expect(evidence.statementCount).toBe(5);
    expect(snapshot).not.toHaveProperty("views");
    expect(Object.keys(snapshot.viewFeeds)).toHaveLength(26);
  }, 30_000);
});
