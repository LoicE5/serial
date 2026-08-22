import { describe, expect, it, vi } from "vitest";

import type { FeedHttpResponse } from "~/server/rss/feedHttp";
import type { YouTubeOrientationProbeStore } from "~/server/rss/youtubeOrientation";
import { checkFeedItemIsVerticalFromUrl } from "~/server/checkFeedItemIsVertical";
import {
  probeYouTubeVideoOrientation,
  YouTubeOrientationProbeRun,
} from "~/server/rss/youtubeOrientation";

const SHORT_ID = "PG_kfqOXqgQ";
const REGULAR_ID = "dQw4w9WgXcQ";
const LATER_ID = "5qap5aO4i9A";

function response(
  status: number,
  headers: Record<string, string> = {},
): FeedHttpResponse {
  return {
    headers: new Headers(headers),
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    text: "",
    url: "",
  };
}

function createStore(): YouTubeOrientationProbeStore & {
  cooldownUntil: Date | null;
} {
  return {
    cooldownUntil: null,
    getClassifications: vi.fn(() => Promise.resolve([])),
    getCooldownUntil() {
      return Promise.resolve(this.cooldownUntil);
    },
    setClassification: vi.fn(() => Promise.resolve()),
    setCooldownUntil(value) {
      this.cooldownUntil = value;
      return Promise.resolve();
    },
  };
}

describe("YouTube Shorts orientation probing", () => {
  it("classifies a direct /shorts/ item as vertical without probing", async () => {
    const store = createStore();
    const probe = vi.fn();
    const run = new YouTubeOrientationProbeRun(store, { probe });

    const outcomes = await run.classifyUrls([
      `https://www.youtube.com/shorts/${SHORT_ID}`,
    ]);

    expect(outcomes.get(`https://www.youtube.com/shorts/${SHORT_ID}`)).toEqual({
      attempted: false,
      checkedAt: null,
      orientation: "vertical",
    });
    expect(probe).not.toHaveBeenCalled();
    expect(
      checkFeedItemIsVerticalFromUrl(
        `https://www.youtube.com/watch?v=${SHORT_ID}`,
      ),
    ).toBeNull();
  });

  it("classifies a watch URL as vertical when the Shorts route and oEmbed both exist", async () => {
    const readHttp = vi
      .fn()
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(200));

    await expect(
      probeYouTubeVideoOrientation(SHORT_ID, { readHttp }),
    ).resolves.toEqual({ orientation: "vertical", rateLimited: false });
    expect(readHttp).toHaveBeenCalledTimes(2);
    expect(readHttp.mock.calls[0]?.[1]).toMatchObject({
      followRedirects: false,
      method: "HEAD",
    });
  });

  it("classifies a regular watch URL as horizontal only for the exact same-ID redirect", async () => {
    const readHttp = vi.fn().mockResolvedValue(
      response(303, {
        location: `https://www.youtube.com/watch?v=${REGULAR_ID}`,
      }),
    );

    await expect(
      probeYouTubeVideoOrientation(REGULAR_ID, { readHttp }),
    ).resolves.toEqual({ orientation: "horizontal", rateLimited: false });
    expect(readHttp).toHaveBeenCalledTimes(1);
  });

  it("leaves unexpected redirects and failed checks ambiguous", async () => {
    const differentIdRedirect = vi.fn().mockResolvedValue(
      response(303, {
        location: `https://www.youtube.com/watch?v=${SHORT_ID}`,
      }),
    );
    const extraParameterRedirect = vi.fn().mockResolvedValue(
      response(303, {
        location: `https://www.youtube.com/watch?v=${REGULAR_ID}&feature=share`,
      }),
    );
    const failure = vi.fn().mockRejectedValue(new Error("network failure"));

    await expect(
      probeYouTubeVideoOrientation(REGULAR_ID, {
        readHttp: differentIdRedirect,
      }),
    ).resolves.toEqual({ orientation: null, rateLimited: false });
    await expect(
      probeYouTubeVideoOrientation(REGULAR_ID, {
        readHttp: extraParameterRedirect,
      }),
    ).resolves.toEqual({ orientation: null, rateLimited: false });
    await expect(
      probeYouTubeVideoOrientation(SHORT_ID, { readHttp: failure }),
    ).resolves.toEqual({ orientation: null, rateLimited: false });
  });

  it("opens and persists a shared circuit on 429, stopping queued and later-run probes", async () => {
    const now = new Date("2026-08-22T12:00:00.000Z");
    const store = createStore();
    const firstProbe = vi
      .fn()
      .mockResolvedValueOnce({ orientation: null, rateLimited: true })
      .mockResolvedValue({ orientation: "horizontal", rateLimited: false });
    const firstRun = new YouTubeOrientationProbeRun(store, {
      maxConcurrentRequests: 1,
      now: () => now,
      probe: firstProbe,
    });

    const firstOutcomes = await firstRun.classifyUrls([
      `https://www.youtube.com/watch?v=${SHORT_ID}`,
      `https://www.youtube.com/watch?v=${REGULAR_ID}`,
    ]);

    expect(firstProbe).toHaveBeenCalledTimes(1);
    expect(
      firstOutcomes.get(`https://www.youtube.com/watch?v=${SHORT_ID}`),
    ).toMatchObject({ attempted: true, orientation: null });
    expect(
      firstOutcomes.get(`https://www.youtube.com/watch?v=${REGULAR_ID}`),
    ).toEqual({ attempted: false, checkedAt: null, orientation: null });
    expect(store.cooldownUntil).toEqual(new Date("2026-08-22T13:00:00.000Z"));

    const laterProbe = vi.fn();
    const laterRun = new YouTubeOrientationProbeRun(store, {
      now: () => new Date("2026-08-22T12:30:00.000Z"),
      probe: laterProbe,
    });
    const laterOutcomes = await laterRun.classifyUrls([
      `https://www.youtube.com/watch?v=${LATER_ID}`,
    ]);

    expect(laterProbe).not.toHaveBeenCalled();
    expect(
      laterOutcomes.get(`https://www.youtube.com/watch?v=${LATER_ID}`),
    ).toEqual({ attempted: false, checkedAt: null, orientation: null });
  });

  it("keeps the per-run network budget bounded under concurrent classification", async () => {
    const store = createStore();
    const probe = vi.fn(() =>
      Promise.resolve({ orientation: null, rateLimited: false } as const),
    );
    const run = new YouTubeOrientationProbeRun(store, {
      maxConcurrentRequests: 4,
      maxNetworkVideos: 2,
      probe,
    });
    const urls = [
      "AAAAAAAAAAA",
      "BBBBBBBBBBB",
      "CCCCCCCCCCC",
      "DDDDDDDDDDD",
    ].map((videoId) => `https://www.youtube.com/watch?v=${videoId}`);

    const outcomes = await run.classifyUrls(urls);

    expect(probe).toHaveBeenCalledTimes(2);
    expect(
      Array.from(outcomes.values()).filter((outcome) => outcome.attempted),
    ).toHaveLength(2);
  });
});
