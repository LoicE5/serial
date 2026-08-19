import { expect, test } from "@playwright/test";
import { seedAdmin, signIn } from "../fixtures/auth";
import { MAIN_TURSO_PORT } from "../fixtures/ports";
import {
  cleanupUser,
  generateTestEmail,
  seedClientPerformanceData,
} from "../fixtures/seed-db";
import type { Page } from "@playwright/test";

async function expectAutomaticOwner(
  page: Page,
  owner: "client" | "background-task",
) {
  await expect
    .poll(() =>
      page.evaluate(
        (expectedOwner) =>
          performance
            .getEntriesByType("mark")
            .some(
              ({ name }) =>
                name === `serial:automatic-rss-owner:${expectedOwner}`,
            ),
        owner,
      ),
    )
    .toBe(true);
}

test.describe.configure({ mode: "serial" });

test("main-instance Free keeps automatic RSS on the client", async ({
  page,
}) => {
  const fixture = await seedClientPerformanceData(MAIN_TURSO_PORT, "small");
  try {
    await signIn({
      page,
      email: fixture.email,
      password: fixture.password,
    });
    await expectAutomaticOwner(page, "client");
  } finally {
    await cleanupUser(MAIN_TURSO_PORT, fixture.email);
  }
});

test("main-instance paid ownership follows the background-refresh switch", async ({
  page,
}) => {
  const email = generateTestEmail();
  const password = "testpassword123";
  await seedAdmin({
    tursoPort: MAIN_TURSO_PORT,
    name: "Paid ownership user",
    email,
    password,
  });
  try {
    await signIn({ page, email, password });
    await expectAutomaticOwner(
      page,
      process.env.SERIAL_EXPECT_AUTOMATIC_RSS_OWNER === "client"
        ? "client"
        : "background-task",
    );
  } finally {
    await cleanupUser(MAIN_TURSO_PORT, email);
  }
});
