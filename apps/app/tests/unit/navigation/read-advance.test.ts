import { describe, expect, it } from "vitest";
import { shouldAdvanceAfterToggleRead } from "~/lib/hooks/readAdvance";

describe("read navigation advance", () => {
  it("advances in global Unread", () => {
    expect(
      shouldAdvanceAfterToggleRead({
        contentStatusFilter: { saveStatus: "inbox", archiveStatus: "unread" },
      }),
    ).toBe(true);
  });

  it("advances in Saved + Unread", () => {
    expect(
      shouldAdvanceAfterToggleRead({
        contentStatusFilter: { saveStatus: "saved", archiveStatus: "unread" },
      }),
    ).toBe(true);
  });

  it("stays selected in Saved + Archived", () => {
    expect(
      shouldAdvanceAfterToggleRead({
        contentStatusFilter: {
          saveStatus: "saved",
          archiveStatus: "archived",
        },
      }),
    ).toBe(false);
  });
});
