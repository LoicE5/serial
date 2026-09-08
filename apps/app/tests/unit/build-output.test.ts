import { describe, expect, it } from "vitest";
import { getBuildOutput } from "../../scripts/build-output";

describe("build output", () => {
  it("uses Nitro's local output by default", () => {
    expect(getBuildOutput({})).toEqual({
      publicDirectory: ".output/public",
      serverDirectory: ".output/server",
    });
  });

  it("uses the Vercel Build Output API layout on Vercel", () => {
    expect(getBuildOutput({ VERCEL: "1" })).toEqual({
      publicDirectory: ".vercel/output/static",
    });
  });

  it("honors an explicit Vercel Nitro preset locally", () => {
    expect(getBuildOutput({ NITRO_PRESET: "vercel" })).toEqual({
      publicDirectory: ".vercel/output/static",
    });
  });

  it("lets an explicit Node Nitro preset override Vercel detection", () => {
    expect(getBuildOutput({ NITRO_PRESET: "node", VERCEL: "1" })).toEqual({
      publicDirectory: ".output/public",
      serverDirectory: ".output/server",
    });
  });
});
