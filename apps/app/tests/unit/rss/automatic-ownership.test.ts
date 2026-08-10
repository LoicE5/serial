import { describe, expect, it } from "vitest";
import { automaticRssOwnerFor } from "~/server/rss/automaticOwnership";

describe("automatic RSS ownership", () => {
  it.each([
    {
      name: "main-instance Free",
      backgroundRefreshEnabled: true,
      backgroundRefreshIntervalMs: null,
      expected: "client",
    },
    {
      name: "paid with the background task enabled",
      backgroundRefreshEnabled: true,
      backgroundRefreshIntervalMs: 60_000,
      expected: "background-task",
    },
    {
      name: "paid with the background task disabled",
      backgroundRefreshEnabled: false,
      backgroundRefreshIntervalMs: 60_000,
      expected: "client",
    },
    {
      name: "self-hosted with the background task enabled",
      backgroundRefreshEnabled: true,
      backgroundRefreshIntervalMs: 60_000,
      expected: "background-task",
    },
    {
      name: "self-hosted with the background task disabled",
      backgroundRefreshEnabled: false,
      backgroundRefreshIntervalMs: 60_000,
      expected: "client",
    },
  ])("selects $expected for $name", (input) => {
    expect(automaticRssOwnerFor(input)).toBe(input.expected);
  });
});
