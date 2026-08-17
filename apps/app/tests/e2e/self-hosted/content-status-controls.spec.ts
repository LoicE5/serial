import { expect, test } from "@playwright/test";
import { signIn } from "../fixtures/auth";
import {
  SELF_HOSTED_APP_PORT,
  SELF_HOSTED_TURSO_PORT,
} from "../fixtures/ports";
import { cleanupUser, seedArticleData } from "../fixtures/seed-db";
import type { Locator, Page } from "@playwright/test";

function contentStatusTab(page: Page, name: string) {
  const isSaveStatus = name === "Inbox" || name === "Saved";
  const accessibleName = isSaveStatus
    ? new RegExp(`^${name}`)
    : `Switch to ${name.toLowerCase()} content`;
  const axisAnchor = isSaveStatus ? /^Inbox/ : "Switch to unread content";

  return page
    .locator('[data-slot="tabs-list"]')
    .filter({ has: page.getByRole("tab", { name: axisAnchor }) })
    .getByRole("tab", { name: accessibleName });
}

async function expectSelected(tab: Locator, selected: boolean) {
  await expect(tab).toHaveAttribute("aria-selected", String(selected));
}

test.describe("content status controls", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  let testEmail = "";

  test.afterEach(async () => {
    if (testEmail) await cleanupUser(SELF_HOSTED_TURSO_PORT, testEmail);
  });

  test("exposes two independent accessible axes with shortcuts and tooltips", async ({
    page,
  }) => {
    const { email, password } = await seedArticleData(
      SELF_HOSTED_TURSO_PORT,
      SELF_HOSTED_APP_PORT,
    );
    testEmail = email;
    await signIn({ page, email, password });
    await expect(page.locator("article").first()).toBeVisible({
      timeout: 30_000,
    });

    const inbox = contentStatusTab(page, "Inbox");
    const saved = contentStatusTab(page, "Saved");
    const unread = contentStatusTab(page, "Unread");
    const archived = contentStatusTab(page, "Archived");

    await expect(inbox).toBeVisible();
    await expect(saved).toBeVisible();
    await expect(unread).toHaveAccessibleName("Switch to unread content");
    await expect(archived).toHaveAccessibleName("Switch to archived content");
    await expect(unread.locator("svg")).toHaveCount(1);
    await expect(archived.locator("svg")).toHaveCount(1);
    await page.keyboard.down("Alt");
    await expect(inbox.locator("kbd")).toHaveText("i");
    await expect(saved.locator("kbd")).toHaveText("b");
    await expect(unread.locator("kbd")).toHaveText("u");
    await expect(archived.locator("kbd")).toHaveText("y");
    await page.keyboard.up("Alt");
    await expect(
      page.getByRole("tab", { name: "All", exact: true }),
    ).toHaveCount(0);

    await unread.hover();
    await expect(page.getByRole("tooltip", { name: "Unread" })).toBeVisible();
    await archived.hover();
    await expect(page.getByRole("tooltip", { name: "Archived" })).toBeVisible();

    await expectSelected(inbox, true);
    await expectSelected(unread, true);
    await expect(
      page.getByRole("button", { name: "Mark all as read" }),
    ).toBeVisible();

    await saved.click();
    await expectSelected(saved, true);
    await expectSelected(unread, true);
    await expect(
      page.getByRole("button", { name: "Mark all as read" }),
    ).toHaveCount(0);

    await archived.click();
    await expectSelected(saved, true);
    await expectSelected(archived, true);

    await page.keyboard.press("i");
    await expectSelected(inbox, true);
    await expectSelected(archived, true);
    await page.keyboard.press("u");
    await expectSelected(inbox, true);
    await expectSelected(unread, true);
    await expect(
      page.getByRole("button", { name: "Mark all as read" }),
    ).toBeVisible();
    await page.keyboard.press("b");
    await expectSelected(saved, true);
    await expectSelected(unread, true);
    await page.keyboard.press("y");
    await expectSelected(saved, true);
    await expectSelected(archived, true);
  });

  test("keeps both axes adjacent above View chips at desktop and mobile widths", async ({
    page,
  }) => {
    const { email, password } = await seedArticleData(
      SELF_HOSTED_TURSO_PORT,
      SELF_HOSTED_APP_PORT,
    );
    testEmail = email;
    await signIn({ page, email, password });

    const saveAxis = contentStatusTab(page, "Inbox").locator("xpath=..");
    const archiveAxis = contentStatusTab(page, "Unread").locator("xpath=..");
    const viewChip = page.getByRole("radio", { name: "All", exact: true });

    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(saveAxis).toBeVisible();
      await expect(archiveAxis).toBeVisible();
      await expect(viewChip).toBeVisible();

      const [saveBox, archiveBox, viewBox] = await Promise.all([
        saveAxis.boundingBox(),
        archiveAxis.boundingBox(),
        viewChip.boundingBox(),
      ]);
      expect(saveBox).not.toBeNull();
      expect(archiveBox).not.toBeNull();
      expect(viewBox).not.toBeNull();
      expect(Math.abs(saveBox!.y - archiveBox!.y)).toBeLessThan(2);
      expect(archiveBox!.x).toBeGreaterThan(saveBox!.x + saveBox!.width);
      expect(viewBox!.y).toBeGreaterThan(saveBox!.y + saveBox!.height);
    }
  });
});
