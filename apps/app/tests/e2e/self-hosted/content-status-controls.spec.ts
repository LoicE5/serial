import { expect, test } from "@playwright/test";
import { signIn } from "../fixtures/auth";
import {
  SELF_HOSTED_APP_PORT,
  SELF_HOSTED_TURSO_PORT,
} from "../fixtures/ports";
import { cleanupUser, seedArticleData } from "../fixtures/seed-db";
import { saveStatusSwitch, selectSaveStatus } from "../fixtures/content-status";
import type { Locator, Page } from "@playwright/test";

function contentStatusTab(page: Page, name: string) {
  const accessibleName = `Switch to ${name.toLowerCase()} content`;

  return page
    .locator('[data-slot="tabs-list"]')
    .filter({
      has: page.getByRole("tab", { name: "Switch to unread content" }),
    })
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

    const saveSwitch = saveStatusSwitch(page);
    const saveSwitchThumb = saveSwitch.locator(":scope > span[data-state]");
    const unread = contentStatusTab(page, "Unread");
    const archived = contentStatusTab(page, "Archived");

    await expect(saveSwitch).toBeVisible();
    await expect(saveSwitch).toHaveAccessibleName("Inbox or Saved");
    await expect(saveSwitch).toHaveAttribute("aria-checked", "false");
    await expect(saveSwitch).toContainText("Inbox");
    await expect(saveSwitch).toContainText("Saved");
    await expect(unread).toHaveAccessibleName("Switch to unread content");
    await expect(archived).toHaveAccessibleName("Switch to archived content");
    await expect(unread.locator("svg")).toHaveCount(1);
    await expect(archived.locator("svg")).toHaveCount(1);
    await page.keyboard.down("Alt");
    await expect(saveSwitch.locator("kbd")).toHaveText(["i", "b"]);
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

    await expectSelected(unread, true);
    await expect(
      page.getByRole("button", { name: "Mark all as read" }),
    ).toBeVisible();

    const inboxThumbBox = await saveSwitchThumb.boundingBox();
    expect(inboxThumbBox).not.toBeNull();
    await selectSaveStatus(page, "saved");
    await expect(saveSwitch).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () => (await saveSwitchThumb.boundingBox())?.x ?? 0)
      .toBeGreaterThan(inboxThumbBox!.x + inboxThumbBox!.width * 0.8);
    await expectSelected(unread, true);
    await expect(
      page.getByRole("button", { name: "Mark all as read" }),
    ).toHaveCount(0);

    await archived.click();
    await expect(saveSwitch).toHaveAttribute("aria-checked", "true");
    await expectSelected(archived, true);

    await page.keyboard.press("i");
    await expect(saveSwitch).toHaveAttribute("aria-checked", "false");
    await expectSelected(archived, true);
    await page.keyboard.press("u");
    await expect(saveSwitch).toHaveAttribute("aria-checked", "false");
    await expectSelected(unread, true);
    await expect(
      page.getByRole("button", { name: "Mark all as read" }),
    ).toBeVisible();
    await page.keyboard.press("b");
    await expect(saveSwitch).toHaveAttribute("aria-checked", "true");
    await expectSelected(unread, true);
    await page.keyboard.press("y");
    await expect(saveSwitch).toHaveAttribute("aria-checked", "true");
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

    const saveAxis = saveStatusSwitch(page);
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
