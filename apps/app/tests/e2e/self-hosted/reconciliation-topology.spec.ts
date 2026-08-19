import { expect, test } from "@playwright/test";
import { signIn } from "../fixtures/auth";
import { indexedDbKeys } from "../fixtures/indexed-db";
import {
  SELF_HOSTED_APP_PORT,
  SELF_HOSTED_RSS_SERVER_PORT,
  SELF_HOSTED_TURSO_PORT,
} from "../fixtures/ports";
import {
  cleanupUser,
  seedClientPerformanceData,
  seedMixedViewSectionCase,
  seedRssPartialFailureData,
} from "../fixtures/seed-db";
import type { Page } from "@playwright/test";
import { E2E_BOOKMARK_HYDRATION_DELAY_KEY } from "~/lib/data/e2eFaultControls";

test.describe.configure({ mode: "serial" });

function rpcProcedure(url: string) {
  const pathname = new URL(url).pathname;
  const prefix = "/api/rpc/";
  if (!pathname.startsWith(prefix)) return null;
  return pathname.slice(prefix.length).replaceAll("/", ".");
}

async function parityMarkCount(page: Page) {
  return page.evaluate(
    () => performance.getEntriesByName("serial:server-parity-applied").length,
  );
}

async function latestReconciliationMarkIds(page: Page) {
  return page.evaluate(() => {
    const latestId = (name: string) =>
      performance
        .getEntriesByType("mark")
        .map((entry) => entry.name)
        .filter((entryName) => entryName.startsWith(`${name}:`))
        .at(-1)
        ?.slice(name.length + 1);
    return {
      requested: latestId("serial:reconciliation-requested"),
      organization: latestId("serial:reconciliation-organization-applied"),
      activeScope: latestId("serial:reconciliation-active-scope-applied"),
      navigation: latestId("serial:reconciliation-navigation-applied"),
      parity: latestId("serial:server-parity-applied"),
    };
  });
}

test("uses one finite reconciliation request on startup and reconnect", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await seedClientPerformanceData(
    SELF_HOSTED_TURSO_PORT,
    "small",
  );
  const procedures: string[] = [];
  page.on("request", (request) => {
    const procedure = rpcProcedure(request.url());
    if (procedure) procedures.push(procedure);
  });

  try {
    await signIn({
      page,
      email: fixture.email,
      password: fixture.password,
    });
    await expect(page.getByText(/Fixture item \d+/).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect.poll(() => parityMarkCount(page)).toBe(1);

    const reconciliationProcedure = "initial.reconcileApplicationState";
    expect(
      procedures.filter((procedure) => procedure === reconciliationProcedure),
    ).toHaveLength(1);
    expect(procedures).not.toEqual(
      expect.arrayContaining([
        "initial.requestInitialData",
        "mixedContent.synchronize",
        "viewFeeds.getAll",
        "mixedContent.requestPage",
        "initial.getNavigationSnapshot",
      ]),
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          performance
            .getEntriesByType("mark")
            .some(({ name }) =>
              name.startsWith("serial:server-parity-applied:"),
            ),
        ),
      )
      .toBe(true);
    const expectedOwner =
      process.env.SERIAL_EXPECT_AUTOMATIC_RSS_OWNER === "client"
        ? "client"
        : "background-task";
    await expect
      .poll(() =>
        page.evaluate(
          (owner) =>
            performance
              .getEntriesByType("mark")
              .some(
                ({ name }) => name === `serial:automatic-rss-owner:${owner}`,
              ),
          expectedOwner,
        ),
      )
      .toBe(true);

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await expect.poll(() => parityMarkCount(page)).toBe(2);
    expect(
      procedures.filter((procedure) => procedure === reconciliationProcedure),
    ).toHaveLength(2);
    const reconciliationIds = await latestReconciliationMarkIds(page);
    expect(reconciliationIds.requested).toBeTruthy();
    expect(reconciliationIds).toEqual({
      requested: reconciliationIds.requested,
      organization: reconciliationIds.requested,
      activeScope: reconciliationIds.requested,
      navigation: reconciliationIds.requested,
      parity: reconciliationIds.requested,
    });
  } finally {
    await cleanupUser(SELF_HOSTED_TURSO_PORT, fixture.email);
  }
});

test("reconciles once offline and once after a late first subscription", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await seedClientPerformanceData(
    SELF_HOSTED_TURSO_PORT,
    "small",
  );
  let subscriptionAttempts = 0;
  let reconciliationRequests = 0;
  await page.route("**/api/rpc/**", async (route) => {
    const procedure = rpcProcedure(route.request().url());
    if (procedure === "initial.reconcileApplicationState") {
      reconciliationRequests++;
    }
    if (procedure === "initial.subscribe" && subscriptionAttempts++ === 0) {
      await route.abort("connectionfailed");
      return;
    }
    await route.continue();
  });

  try {
    await signIn({
      page,
      email: fixture.email,
      password: fixture.password,
    });
    await expect(page.getByText(/Fixture item \d+/).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect.poll(() => reconciliationRequests).toBe(2);
    await expect.poll(() => parityMarkCount(page)).toBe(2);
    expect(subscriptionAttempts).toBeGreaterThanOrEqual(2);
    await expect
      .poll(() =>
        page.evaluate(() =>
          performance
            .getEntriesByType("mark")
            .some(({ name }) => name === "serial:subscription-connected"),
        ),
      )
      .toBe(true);
  } finally {
    await cleanupUser(SELF_HOSTED_TURSO_PORT, fixture.email);
  }
});

test("keeps applied cache usable and retries one failed View page", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await seedClientPerformanceData(
    SELF_HOSTED_TURSO_PORT,
    "small",
  );
  let injectFailure = true;
  const reconciliationRequests: string[] = [];
  await page.route("**/api/rpc/**", async (route) => {
    const procedure = rpcProcedure(route.request().url());
    if (procedure !== "initial.reconcileApplicationState") {
      await route.continue();
      return;
    }
    reconciliationRequests.push(procedure);
    if (!injectFailure) {
      await route.continue();
      return;
    }
    injectFailure = false;
    await route.continue({
      headers: {
        ...route.request().headers(),
        "x-serial-e2e-reconciliation-failure": "view-page-once",
      },
    });
  });

  try {
    await signIn({
      page,
      email: fixture.email,
      password: fixture.password,
    });
    await expect(page.getByText(/Fixture item \d+/).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect.poll(() => parityMarkCount(page)).toBe(1);
    expect(reconciliationRequests).toHaveLength(2);

    const marks = await page.evaluate(() =>
      performance
        .getEntriesByType("mark")
        .filter(({ name }) =>
          [
            "serial:cache-usable",
            "serial:reconciliation-organization-applied",
            "serial:reconciliation-active-scope-applied",
            "serial:server-parity-applied",
          ].includes(name),
        )
        .map(({ name, startTime }) => ({ name, startTime })),
    );
    const markTime = (name: string) =>
      marks.find((mark) => mark.name === name)?.startTime;
    expect(markTime("serial:cache-usable")).toBeLessThan(
      markTime("serial:server-parity-applied")!,
    );
    expect(markTime("serial:reconciliation-organization-applied")).toBeLessThan(
      markTime("serial:server-parity-applied")!,
    );
    expect(markTime("serial:reconciliation-active-scope-applied")).toBeLessThan(
      markTime("serial:server-parity-applied")!,
    );
  } finally {
    await cleanupUser(SELF_HOSTED_TURSO_PORT, fixture.email);
  }
});

test("reports multi-Feed RSS progress and performs one consolidated repair after a partial failure", async ({
  page,
}) => {
  test.skip(
    process.env.SERIAL_EXPECT_AUTOMATIC_RSS_OWNER === "background-task",
    "client-owned RSS acceptance only",
  );
  test.setTimeout(120_000);
  const fixture = await seedRssPartialFailureData(
    SELF_HOSTED_TURSO_PORT,
    SELF_HOSTED_APP_PORT,
    SELF_HOSTED_RSS_SERVER_PORT,
  );
  const procedures: string[] = [];
  page.on("request", (request) => {
    const procedure = rpcProcedure(request.url());
    if (procedure) procedures.push(procedure);
  });
  await page.addInitScript(() => {
    const progressTransforms: string[] = [];
    Object.defineProperty(window, "__serialRssProgressTransforms", {
      value: progressTransforms,
      configurable: true,
    });
    const recordProgress = (element: Element) => {
      if (
        element instanceof HTMLElement &&
        element.classList.contains("transition-transform") &&
        element.style.transform
      ) {
        progressTransforms.push(element.style.transform);
      }
      for (const descendant of element.querySelectorAll(
        ".transition-transform",
      )) {
        if (descendant instanceof HTMLElement && descendant.style.transform) {
          progressTransforms.push(descendant.style.transform);
        }
      }
    };
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const element = mutation.target;
        if (element instanceof Element) recordProgress(element);
        for (const addedNode of mutation.addedNodes) {
          if (addedNode instanceof Element) recordProgress(addedNode);
        }
      }
    }).observe(document, {
      attributes: true,
      attributeFilter: ["style"],
      childList: true,
      subtree: true,
    });
  });

  try {
    await signIn({
      page,
      email: fixture.email,
      password: fixture.password,
    });
    await expect(page.getByText(fixture.successTitle)).toBeVisible({
      timeout: 60_000,
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            performance.getEntriesByName("serial:rss-start").length === 1 &&
            performance.getEntriesByName("serial:rss-complete").length === 1,
        ),
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          procedures.filter(
            (procedure) => procedure === "initial.reconcileApplicationState",
          ).length,
      )
      .toBe(2);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as typeof window & {
              __serialRssProgressTransforms: string[];
            }
          ).__serialRssProgressTransforms.some((value) =>
            value.includes("-50%"),
          ),
        ),
      )
      .toBe(true);
  } finally {
    await cleanupUser(SELF_HOSTED_TURSO_PORT, fixture.email);
  }
});

test("keeps cached Feed rows usable while real Bookmark hydration gates Bookmark authority", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await seedMixedViewSectionCase(
    SELF_HOSTED_TURSO_PORT,
    SELF_HOSTED_APP_PORT,
    {
      feedSectionFeedItem: false,
      tagSectionFeedItem: true,
      tagSectionBookmark: true,
      uncategorizedFeedItem: false,
      uncategorizedBookmark: false,
    },
    { saveStatus: "inbox", archiveStatus: "unread" },
  );

  try {
    await signIn({
      page,
      email: fixture.email,
      password: fixture.password,
    });
    const feedMain = page
      .locator("main")
      .filter({
        has: page.getByRole("heading", { name: "Serial", exact: true }),
      })
      .last();
    const viewChip = feedMain.getByRole("radio", {
      name: fixture.viewName,
      exact: true,
    });
    await viewChip.click();
    const feedItem = feedMain.locator(
      `article[data-item-id="${fixture.items.tagSectionFeedItem}"]`,
    );
    const bookmark = feedMain.locator(
      `article[data-item-id="${fixture.items.tagSectionBookmark}"]`,
    );
    await expect(feedItem).toBeVisible({ timeout: 30_000 });
    await expect(bookmark).toBeVisible();
    await expect
      .poll(
        async () =>
          (await indexedDbKeys(page)).includes(
            "serial-bookmarks-store::normalized:v1::root",
          ),
        { timeout: 30_000 },
      )
      .toBe(true);

    await page.evaluate(
      (delayKey) => sessionStorage.setItem(delayKey, "8000"),
      E2E_BOOKMARK_HYDRATION_DELAY_KEY,
    );

    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(
          () => performance.getEntriesByName("serial:cache-usable").length,
        ),
      )
      .toBe(1);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            performance.getEntriesByName(
              "serial:e2e-bookmark-hydration-released",
            ).length,
        ),
      )
      .toBe(0);

    await viewChip.click();
    await expect(feedItem).toBeVisible({ timeout: 5_000 });
    await expect(bookmark).toHaveCount(0);
    expect(await parityMarkCount(page)).toBe(0);

    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              performance.getEntriesByName(
                "serial:e2e-bookmark-hydration-released",
              ).length,
          ),
        { timeout: 15_000 },
      )
      .toBe(1);
    await expect(bookmark).toBeVisible({ timeout: 30_000 });
    await expect(feedItem).toBeVisible();
    await expect.poll(() => parityMarkCount(page)).toBeGreaterThanOrEqual(1);
    const boundaries = await page.evaluate(() => ({
      cacheUsable: performance.getEntriesByName("serial:cache-usable")[0]
        ?.startTime,
      bookmarkHydrated: performance.getEntriesByName(
        "serial:e2e-bookmark-hydration-released",
      )[0]?.startTime,
      parity: performance.getEntriesByName("serial:server-parity-applied")[0]
        ?.startTime,
    }));
    expect(boundaries.cacheUsable).toBeLessThan(boundaries.bookmarkHydrated!);
    expect(boundaries.bookmarkHydrated).toBeLessThan(boundaries.parity!);
  } finally {
    await cleanupUser(SELF_HOSTED_TURSO_PORT, fixture.email);
  }
});
