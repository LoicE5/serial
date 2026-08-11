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
  it("uses indexed membership-first plans for custom-View Feed availability", async () => {
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
    const viewAvailabilitySql =
      session.instrumentation.snapshot().statements[0]!.sql;
    const plan = await session.baseClient.execute({
      sql: `EXPLAIN QUERY PLAN ${viewAvailabilitySql}`,
      args: Array.from(
        { length: viewAvailabilitySql.match(/\?/g)?.length ?? 0 },
        () => null,
      ),
    });
    const planDetails = plan.rows.map((row) => String(row.detail));
    const joinedPlan = planDetails.join("\n");

    expect(
      planDetails.filter((detail) =>
        /^SCAN serial_(view_feeds|view_categories|feed_categories|feed|feed_item)\b/.test(
          detail,
        ),
      ),
    ).toEqual([]);
    expect(
      joinedPlan.match(
        /SEARCH serial_view_feeds[^\n]*\nSEARCH serial_feed [^\n]*\nSEARCH serial_feed_item[^\n]*/g,
      ),
    ).toHaveLength(3);
    expect(
      joinedPlan.match(
        /SEARCH serial_view_categories[^\n]*\nSEARCH serial_feed_categories[^\n]*\nSEARCH serial_feed [^\n]*\nSEARCH serial_feed_item[^\n]*/g,
      ),
    ).toHaveLength(3);
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
        Object.keys(snapshot.views).length +
        Object.keys(snapshot.tags).length +
        Object.keys(snapshot.feeds).length;
      const viewFeedMembershipCount = Object.values(snapshot.viewFeeds).reduce(
        (count, feedAvailability) =>
          count + Object.keys(feedAvailability).length,
        0,
      );

      expect(evidence.statementCount).toBe(6);
      expect(evidence.materializedRows).toBe(
        navigationEntityCount + viewFeedMembershipCount,
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

    expect(evidence.statementCount).toBe(6);
    expect(Object.values(snapshot.views)).toEqual(
      expect.arrayContaining([{ unread: true, read: false, later: false }]),
    );
    expect(Object.values(snapshot.views)).toHaveLength(26);
    expect(
      Object.values(snapshot.views).every(
        (availability) =>
          availability.unread && !availability.read && !availability.later,
      ),
    ).toBe(true);
  }, 30_000);
});
