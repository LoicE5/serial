import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { serialize } from "node:v8";
import {
  applyMigrations,
  createLocalBenchmarkTarget,
  openBenchmarkDatabase,
} from "./database";
import { seedBenchmarkFixture } from "./fixtures";
import { BENCHMARK_PROFILES, distribution } from "./model";
import {
  evaluateViewMatrixGate,
  VIEW_MATRIX_BUDGETS,
} from "./view-matrix-model";
import type { ActiveFirstPageResult } from "~/lib/reconciliation";
import type { ScopeData } from "~/server/mixed-content/projection/scope";
import { getFeedItemMembershipRevision } from "~/lib/data/feed-items/membershipRevision";
import { getPersistedFeedItemRetentionState } from "~/lib/data/feed-page-retention";
import { bookmarksStore } from "~/lib/data/bookmarks/store";
import { mixedContentStore } from "~/lib/data/mixed-content/store";
import { getPersistedMixedContentState } from "~/lib/data/mixed-content/page-retention";
import { applyReconciliationFirstPage } from "~/lib/data/reconciliationPage";
import { feedItemsStore } from "~/lib/data/store";
import { reconcileApplicationState } from "~/server/reconciliation";
import {
  queryMixedContentPage,
  queryResolvedMixedContentPage,
} from "~/server/mixed-content/projection";
import { loadScopeData } from "~/server/mixed-content/projection/scope";
import { ITEMS_PER_PAGE } from "~/server/api/constants";

const PROFILE = "stress" as const;
const WARMUPS = 2;
const REPETITIONS = 7;
const PAGE_CONCURRENCY = 4;

type ServerSample = {
  operation: "ordinary-pages" | "resolved-pages" | "reconciliation-matrix";
  fullMatrixMs: number;
  pageDurationsMs: number[];
};

function targetKey(page: ActiveFirstPageResult) {
  const scope = page.target.scope;
  const id =
    scope.type === "view"
      ? scope.viewId
      : scope.type === "feed"
        ? scope.feedId
        : scope.tagId;
  return `${scope.type}:${id}:${page.target.contentStatus.saveStatus}:${page.target.contentStatus.archiveStatus}`;
}

function pageSignature(page: ActiveFirstPageResult) {
  return page.orderedRefs.map(
    (reference) => `${reference.entityKind}:${reference.entityId}`,
  );
}

async function measureMatrix(input: {
  database: ReturnType<typeof openBenchmarkDatabase>["database"];
  userId: string;
  sequence: number;
}) {
  globalThis.gc?.();
  const pages: ActiveFirstPageResult[] = [];
  const startedAt = performance.now();
  for await (const event of reconcileApplicationState({
    database: input.database,
    userId: input.userId,
    request: {
      type: "full",
      reconciliationId: `view-matrix-${input.sequence}`,
      selection: {
        type: "cold",
        contentStatus: { saveStatus: "inbox", archiveStatus: "unread" },
        membershipRevision: getFeedItemMembershipRevision(),
      },
    },
  })) {
    if (event.chunk.type === "domain-error") {
      throw new Error(event.chunk.failure.message);
    }
    if (event.chunk.type === "active-first-page") {
      pages.push(event.chunk.page);
    }
  }
  const fullMatrixMs = performance.now() - startedAt;
  return {
    pages,
    sample: {
      operation: "reconciliation-matrix",
      fullMatrixMs,
      pageDurationsMs: [],
    } satisfies ServerSample,
  };
}

function assertEquivalentPage(input: {
  expected: ActiveFirstPageResult;
  references: Array<{ entityKind: string; entityId: string }>;
}) {
  const actual = input.references.map(
    (reference) => `${reference.entityKind}:${reference.entityId}`,
  );
  if (
    JSON.stringify(actual) !== JSON.stringify(pageSignature(input.expected))
  ) {
    throw new Error(`Ordinary page differs for ${targetKey(input.expected)}`);
  }
}

async function measureOrdinaryPages(input: {
  database: ReturnType<typeof openBenchmarkDatabase>["database"];
  userId: string;
  expectedPages: ActiveFirstPageResult[];
}) {
  globalThis.gc?.();
  const pageDurationsMs: number[] = [];
  const startedAt = performance.now();
  for (
    let start = 0;
    start < input.expectedPages.length;
    start += PAGE_CONCURRENCY
  ) {
    const batch = input.expectedPages.slice(start, start + PAGE_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (expected) => {
        const pageStartedAt = performance.now();
        const page = await queryMixedContentPage({
          database: input.database,
          userId: input.userId,
          scope: expected.target.scope,
          contentStatus: expected.target.contentStatus,
          limit: ITEMS_PER_PAGE,
        });
        return {
          expected,
          page,
          durationMs: performance.now() - pageStartedAt,
        };
      }),
    );
    for (const { durationMs, expected, page } of results) {
      assertEquivalentPage({ expected, references: page.references });
      pageDurationsMs.push(durationMs);
    }
  }
  const fullMatrixMs = performance.now() - startedAt;
  return {
    operation: "ordinary-pages",
    fullMatrixMs,
    pageDurationsMs,
  } satisfies ServerSample;
}

async function measureResolvedPages(input: {
  database: ReturnType<typeof openBenchmarkDatabase>["database"];
  userId: string;
  expectedPages: ActiveFirstPageResult[];
  scopeDataByTarget: Map<string, ScopeData>;
}) {
  globalThis.gc?.();
  const pageDurationsMs: number[] = [];
  const startedAt = performance.now();
  for (
    let start = 0;
    start < input.expectedPages.length;
    start += PAGE_CONCURRENCY
  ) {
    const batch = input.expectedPages.slice(start, start + PAGE_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (expected) => {
        const scopeData = input.scopeDataByTarget.get(targetKey(expected));
        if (!scopeData)
          throw new Error(`Missing scope data for ${targetKey(expected)}`);
        const pageStartedAt = performance.now();
        const page = await queryResolvedMixedContentPage({
          database: input.database,
          userId: input.userId,
          scope: expected.target.scope,
          scopeData,
          contentStatus: expected.target.contentStatus,
          limit: ITEMS_PER_PAGE,
        });
        return {
          expected,
          page,
          durationMs: performance.now() - pageStartedAt,
        };
      }),
    );
    for (const { durationMs, expected, page } of results) {
      assertEquivalentPage({ expected, references: page.references });
      pageDurationsMs.push(durationMs);
    }
  }
  return {
    operation: "resolved-pages",
    fullMatrixMs: performance.now() - startedAt,
    pageDurationsMs,
  } satisfies ServerSample;
}

function summarizeFullMatrix(samples: ServerSample[]) {
  return {
    samples: samples.length,
    fullMatrixMs: distribution(samples.map((sample) => sample.fullMatrixMs)),
  };
}

function summarizePages(samples: ServerSample[]) {
  const pageDurationsMs = samples.flatMap((sample) => sample.pageDurationsMs);
  return {
    samples: pageDurationsMs.length,
    durationMs: distribution(pageDurationsMs),
  };
}

function resetClientStores() {
  bookmarksStore.getState().reset();
  mixedContentStore.getState().reset();
  feedItemsStore.getState().reset();
}

function applyOnClient(pages: ActiveFirstPageResult[]) {
  resetClientStores();
  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const applyTasksMs = pages.map((page) => {
    const startedAt = performance.now();
    if (!applyReconciliationFirstPage(page)) {
      throw new Error(`Client rejected current page ${targetKey(page)}`);
    }
    return performance.now() - startedAt;
  });
  globalThis.gc?.();
  const startupHeapGrowthBytes = Math.max(
    0,
    process.memoryUsage().heapUsed - heapBefore,
  );
  const application = serialize(
    getPersistedFeedItemRetentionState(feedItemsStore.getState()),
  ).byteLength;
  const bookmarks = serialize({
    bookmarksDict: bookmarksStore.getState().snapshot(),
  }).byteLength;
  const mixedContent = serialize(
    getPersistedMixedContentState(mixedContentStore.getState()),
  ).byteLength;
  return {
    applyTasksMs: distribution(applyTasksMs),
    maximumApplyTaskMs: Math.max(...applyTasksMs),
    startupHeapGrowthBytes,
    persistedStateBytes: application + bookmarks + mixedContent,
    persistedStateBreakdown: { application, bookmarks, mixedContent },
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      gate: { type: "boolean", default: false },
      output: { type: "string" },
    },
  });
  const target = createLocalBenchmarkTarget();
  const session = openBenchmarkDatabase({ url: target.url });
  const userId = `view-matrix-benchmark-${randomUUID()}`;

  try {
    await applyMigrations(session.baseClient);
    await seedBenchmarkFixture({
      database: session.database,
      profileName: PROFILE,
      userId,
    });

    const samples: ServerSample[] = [];
    let expectedPages: ActiveFirstPageResult[] = [];
    let clientPages: ActiveFirstPageResult[] = [];
    let scopeDataByTarget = new Map<string, ScopeData>();
    for (let index = 0; index < WARMUPS + REPETITIONS; index += 1) {
      const candidateFirst = index % 2 === 0;
      const operations = candidateFirst
        ? (["candidate", "resolved", "baseline"] as const)
        : (["baseline", "resolved", "candidate"] as const);
      for (const operation of operations) {
        if (operation === "candidate") {
          const measured = await measureMatrix({
            database: session.database,
            userId,
            sequence: index,
          });
          expectedPages = measured.pages;
          clientPages = measured.pages;
          if (scopeDataByTarget.size === 0) {
            scopeDataByTarget = new Map(
              await Promise.all(
                expectedPages.map(
                  async (page) =>
                    [
                      targetKey(page),
                      await loadScopeData({
                        database: session.database,
                        userId,
                        scope: page.target.scope,
                      }),
                    ] as const,
                ),
              ),
            );
          }
          if (index >= WARMUPS) samples.push(measured.sample);
        } else if (operation === "baseline") {
          if (expectedPages.length === 0) {
            throw new Error(
              "Candidate pages must establish the baseline matrix",
            );
          }
          const sample = await measureOrdinaryPages({
            database: session.database,
            userId,
            expectedPages,
          });
          if (index >= WARMUPS) samples.push(sample);
        } else {
          if (expectedPages.length === 0) {
            throw new Error(
              "Candidate pages must establish the resolved matrix",
            );
          }
          const sample = await measureResolvedPages({
            database: session.database,
            userId,
            expectedPages,
            scopeDataByTarget,
          });
          if (index >= WARMUPS) samples.push(sample);
        }
      }
    }

    const ordinarySamples = samples.filter(
      (sample) => sample.operation === "ordinary-pages",
    );
    const matrixSamples = samples.filter(
      (sample) => sample.operation === "reconciliation-matrix",
    );
    const resolvedSamples = samples.filter(
      (sample) => sample.operation === "resolved-pages",
    );
    const baseline = {
      fullMatrix: summarizeFullMatrix(ordinarySamples),
      perPage: summarizePages(ordinarySamples),
    };
    const candidate = {
      fullMatrix: summarizeFullMatrix(matrixSamples),
      perPage: summarizePages(resolvedSamples),
    };
    const latency = {
      perPageMedianRatio:
        candidate.perPage.durationMs.median /
        baseline.perPage.durationMs.median,
      perPageP95Ratio:
        candidate.perPage.durationMs.p95 / baseline.perPage.durationMs.p95,
      fullMatrixMedianRatio:
        candidate.fullMatrix.fullMatrixMs.median /
        baseline.fullMatrix.fullMatrixMs.median,
      fullMatrixP95Ratio:
        candidate.fullMatrix.fullMatrixMs.p95 /
        baseline.fullMatrix.fullMatrixMs.p95,
    };
    const client = applyOnClient(clientPages);
    const measurement = {
      latency,
      client: {
        maximumApplyTaskMs: client.maximumApplyTaskMs,
        startupHeapGrowthBytes: client.startupHeapGrowthBytes,
        persistedStateBytes: client.persistedStateBytes,
      },
    };
    const violations = evaluateViewMatrixGate(measurement);
    const result = {
      schemaVersion: 1,
      profile: { name: PROFILE, ...BENCHMARK_PROFILES[PROFILE] },
      method: {
        warmups: WARMUPS,
        repetitions: REPETITIONS,
        pageConcurrency: PAGE_CONCURRENCY,
        matrixCells: clientPages.length,
        baseline: "ordinary queryMixedContentPage calls over the same cells",
        pairing: "interleaved on one seeded database with alternating order",
      },
      budgets: VIEW_MATRIX_BUDGETS,
      baseline,
      candidate,
      latency,
      client,
      passed: violations.length === 0,
      violations,
      rawSamples: samples,
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (values.output) {
      const outputPath = path.resolve(values.output);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, serialized, "utf8");
    }
    process.stdout.write(serialized);
    if (values.gate && violations.length > 0) process.exitCode = 1;
  } finally {
    resetClientStores();
    session.close();
    target.cleanup();
  }
}

await main();
