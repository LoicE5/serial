import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { format } from "prettier";
import {
  applyMigrations,
  createLocalBenchmarkTarget,
  openBenchmarkDatabase,
} from "./database";
import { seedBenchmarkFixture } from "./fixtures";
import { BENCHMARK_PROFILES, distribution } from "./model";
import type { BenchmarkProfileName } from "./model";
import { queryNavigationSnapshot as queryCandidate } from "~/server/navigation/snapshot";

type NavigationProfileName = BenchmarkProfileName | "adversarial";
type SnapshotQuery = typeof queryCandidate;
type Operation = "baseline" | "candidate";

type RunnerOptions = {
  profileName: NavigationProfileName;
  baselineModule?: string;
  outputPath?: string;
  warmups?: number;
  repetitions?: number;
};

type Sample = {
  operation: Operation;
  fullDurationMs: number;
  viewStatementDurationMs: number;
  statementCount: number;
  resultBytes: number;
};

function argumentValue(argumentsList: string[], name: string) {
  const index = argumentsList.indexOf(name);
  return index === -1 ? undefined : argumentsList[index + 1];
}

function numberArgument(argumentsList: string[], name: string) {
  const value = argumentValue(argumentsList, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function parseOptions(argumentsList: string[]): RunnerOptions {
  const profileName =
    (argumentValue(argumentsList, "--profile") as
      NavigationProfileName | undefined) ?? "representative";
  if (profileName !== "adversarial" && !(profileName in BENCHMARK_PROFILES)) {
    throw new Error(`Unknown navigation benchmark profile: ${profileName}`);
  }
  return {
    profileName,
    baselineModule: argumentValue(argumentsList, "--baseline-module"),
    outputPath: argumentValue(argumentsList, "--output"),
    warmups: numberArgument(argumentsList, "--warmups"),
    repetitions: numberArgument(argumentsList, "--repetitions"),
  };
}

async function loadBaseline(modulePath: string): Promise<SnapshotQuery> {
  const module = (await import(
    pathToFileURL(resolve(modulePath)).href
  )) as Partial<{ queryNavigationSnapshot: SnapshotQuery }>;
  if (!module.queryNavigationSnapshot) {
    throw new Error(`${modulePath} does not export queryNavigationSnapshot`);
  }
  return module.queryNavigationSnapshot;
}

async function measure(input: {
  operation: Operation;
  query: SnapshotQuery;
  session: ReturnType<typeof openBenchmarkDatabase>;
  userId: string;
}) {
  input.session.instrumentation.reset();
  globalThis.gc?.();
  const startedAt = performance.now();
  const result = await input.query({
    database: input.session.database,
    userId: input.userId,
  });
  const fullDurationMs = performance.now() - startedAt;
  const evidence = input.session.instrumentation.snapshot();
  return {
    result,
    viewAvailabilitySql: evidence.statements[0]!.sql,
    sample: {
      operation: input.operation,
      fullDurationMs,
      viewStatementDurationMs: evidence.statements[0]!.durationMs,
      statementCount: evidence.statementCount,
      resultBytes: Buffer.byteLength(JSON.stringify(result)),
    } satisfies Sample,
  };
}

function summarize(samples: Sample[]) {
  return {
    samples: samples.length,
    fullDurationMs: distribution(
      samples.map((sample) => sample.fullDurationMs),
    ),
    viewStatementDurationMs: distribution(
      samples.map((sample) => sample.viewStatementDurationMs),
    ),
    statementCount: distribution(
      samples.map((sample) => sample.statementCount),
    ),
    resultBytes: distribution(samples.map((sample) => sample.resultBytes)),
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const fixtureProfile =
    options.profileName === "adversarial" ? "stress" : options.profileName;
  const profile = BENCHMARK_PROFILES[fixtureProfile];
  const warmups = options.warmups ?? profile.warmups;
  const repetitions = options.repetitions ?? profile.repetitions;
  const baseline = options.baselineModule
    ? await loadBaseline(options.baselineModule)
    : undefined;
  const target = createLocalBenchmarkTarget();
  const session = openBenchmarkDatabase({ url: target.url });
  const userId = `navigation-benchmark-${randomUUID()}`;

  try {
    await applyMigrations(session.baseClient);
    const fixture = await seedBenchmarkFixture({
      database: session.database,
      profileName: fixtureProfile,
      userId,
      navigationShape:
        options.profileName === "adversarial"
          ? "all-memberships-unread"
          : "default",
    });

    const queries = {
      baseline,
      candidate: queryCandidate,
    };
    const samples: Sample[] = [];
    let expectedResult: string | undefined;
    let candidateSql: string | undefined;
    for (let index = 0; index < warmups + repetitions; index += 1) {
      const operations: Operation[] = baseline
        ? index % 2 === 0
          ? ["baseline", "candidate"]
          : ["candidate", "baseline"]
        : ["candidate"];
      for (const operation of operations) {
        const measured = await measure({
          operation,
          query: queries[operation]!,
          session,
          userId,
        });
        const serializedResult = JSON.stringify(measured.result);
        expectedResult ??= serializedResult;
        if (serializedResult !== expectedResult) {
          throw new Error("Baseline and candidate navigation snapshots differ");
        }
        if (operation === "candidate") {
          candidateSql = measured.viewAvailabilitySql;
        }
        if (index >= warmups) samples.push(measured.sample);
      }
    }

    const candidate = summarize(
      samples.filter((sample) => sample.operation === "candidate"),
    );
    const baselineSummary = baseline
      ? summarize(samples.filter((sample) => sample.operation === "baseline"))
      : undefined;
    const ratios = baselineSummary
      ? {
          median:
            candidate.fullDurationMs.median /
            baselineSummary.fullDurationMs.median,
          p95:
            candidate.fullDurationMs.p95 / baselineSummary.fullDurationMs.p95,
        }
      : undefined;
    const plan = await session.baseClient.execute({
      sql: `EXPLAIN QUERY PLAN ${candidateSql!}`,
      args: Array.from(
        { length: candidateSql!.match(/\?/g)?.length ?? 0 },
        () => null,
      ),
    });
    const planDetails = plan.rows.map((row) => String(row.detail));
    const missingIndexScans = planDetails.filter((detail) =>
      /^SCAN serial_(view_feeds|view_categories|feed_categories|feed|feed_item)\b/.test(
        detail,
      ),
    );
    const joinedPlan = planDetails.join("\n");
    const membershipFirst =
      (joinedPlan.match(
        /SEARCH serial_view_feeds[^\n]*\nSEARCH serial_feed [^\n]*\nSEARCH serial_feed_item[^\n]*/g,
      )?.length ?? 0) === 3 &&
      (joinedPlan.match(
        /SEARCH serial_view_categories[^\n]*\nSEARCH serial_feed_categories[^\n]*\nSEARCH serial_feed [^\n]*\nSEARCH serial_feed_item[^\n]*/g,
      )?.length ?? 0) === 3;
    if (missingIndexScans.length > 0 || !membershipFirst) {
      throw new Error(
        "Custom-View availability did not use indexed membership-first plans",
      );
    }

    const artifact = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      profile: { name: options.profileName, ...profile },
      fixture,
      method: {
        warmups,
        repetitions,
        pairing: baseline
          ? "interleaved on one local database with alternating first operation"
          : "candidate-only on one local database",
        baselineModule: options.baselineModule,
      },
      baseline: baselineSummary,
      candidate,
      ratios,
      plan: { membershipFirst, missingIndexScans, details: planDetails },
      rawSamples: samples,
    };
    if (options.outputPath) {
      const outputPath = resolve(options.outputPath);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(
        outputPath,
        await format(JSON.stringify(artifact), { filepath: outputPath }),
      );
    }

    process.stdout.write(
      `${options.profileName}: candidate median ${candidate.fullDurationMs.median.toFixed(2)} ms, p95 ${candidate.fullDurationMs.p95.toFixed(2)} ms`,
    );
    if (baselineSummary && ratios) {
      process.stdout.write(
        `; baseline median ${baselineSummary.fullDurationMs.median.toFixed(2)} ms, p95 ${baselineSummary.fullDurationMs.p95.toFixed(2)} ms; ratios ${ratios.median.toFixed(3)}x/${ratios.p95.toFixed(3)}x`,
      );
    }
    process.stdout.write("; indexed membership-first plan PASS\n");
    if (options.outputPath) {
      process.stdout.write(`Artifact: ${resolve(options.outputPath)}\n`);
    }
  } finally {
    session.close();
    target.cleanup();
  }
}

await main();
