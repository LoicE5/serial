import type { Page } from "@playwright/test";

export function saveStatusSwitch(page: Page) {
  return page.getByRole("switch", { name: "Inbox or Saved", exact: true });
}

export async function selectSaveStatus(
  page: Page,
  saveStatus: "inbox" | "saved",
) {
  const control = saveStatusSwitch(page);
  const shouldBeChecked = saveStatus === "saved";
  const isChecked = (await control.getAttribute("aria-checked")) === "true";

  if (isChecked !== shouldBeChecked) await control.click();
}
