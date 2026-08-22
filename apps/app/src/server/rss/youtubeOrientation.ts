import { eq, inArray, sql } from "drizzle-orm";

import { readFeedHttp } from "./feedHttp";
import type { FeedHttpResponse } from "./feedHttp";
import type { db as Database } from "~/server/db";
import { appConfig, youtubeVideoClassifications } from "~/server/db/schema";
import { dbSemaphore, Semaphore } from "~/lib/semaphore";
import { logWarning } from "~/server/logger";

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const YOUTUBE_COOLDOWN_CONFIG_KEY =
  "youtube-shorts-probe-cooldown-until" as const;

export const YOUTUBE_PROBE_TIMEOUT_MS = 3_000;
export const YOUTUBE_PROBE_CONCURRENCY_PER_RUN = 4;
export const YOUTUBE_PROBE_MAX_VIDEOS_PER_RUN = 12;
export const YOUTUBE_PROBE_RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1_000;
export const YOUTUBE_CLASSIFICATION_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const YOUTUBE_ORIENTATION_RETRY_MS = 24 * 60 * 60 * 1_000;
export const YOUTUBE_RECLASSIFICATION_BATCH_SIZE = 8;

type YouTubeUrlReference = {
  kind: "shorts" | "watch";
  videoId: string;
};

type YouTubeVideoOrientation = "horizontal" | "vertical";

export type YouTubeProbeResult = {
  orientation: YouTubeVideoOrientation | null;
  rateLimited: boolean;
};

export type YouTubeOrientationOutcome = {
  attempted: boolean;
  checkedAt: Date | null;
  orientation: YouTubeVideoOrientation | null;
};

type CachedYouTubeOrientation = {
  classifiedAt: Date;
  orientation: YouTubeVideoOrientation;
  videoId: string;
};

export type YouTubeOrientationProbeStore = {
  getClassifications: (
    videoIds: string[],
  ) => Promise<CachedYouTubeOrientation[]>;
  getCooldownUntil: () => Promise<Date | null>;
  setClassification: (value: CachedYouTubeOrientation) => Promise<void>;
  setCooldownUntil: (value: Date) => Promise<void>;
};

export type YouTubeOrientationProbeRunOptions = {
  maxConcurrentRequests?: number;
  maxNetworkVideos?: number;
  now?: () => Date;
  probe?: (videoId: string) => Promise<YouTubeProbeResult>;
};

function isYouTubeHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^www\./, "");
  return normalized === "youtube.com" || normalized === "m.youtube.com";
}

export function parseYouTubeVideoUrl(
  value: string,
): YouTubeUrlReference | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (!isYouTubeHostname(url.hostname)) return null;

  if (url.pathname === "/watch") {
    const videoId = url.searchParams.get("v");
    return videoId && YOUTUBE_VIDEO_ID.test(videoId)
      ? { kind: "watch", videoId }
      : null;
  }

  const shortsMatch = url.pathname.match(/^\/shorts\/([^/]+)\/?$/);
  const videoId = shortsMatch?.[1];
  return videoId && YOUTUBE_VIDEO_ID.test(videoId)
    ? { kind: "shorts", videoId }
    : null;
}

function isExactWatchRedirect(
  response: FeedHttpResponse,
  shortsUrl: string,
  videoId: string,
) {
  if (!YOUTUBE_REDIRECT_STATUSES.has(response.status)) return false;
  const location = response.headers.get("location");
  if (!location) return false;

  try {
    const redirected = new URL(location, shortsUrl);
    const parameters = Array.from(redirected.searchParams.entries());
    return (
      redirected.protocol === "https:" &&
      isYouTubeHostname(redirected.hostname) &&
      redirected.pathname === "/watch" &&
      redirected.hash === "" &&
      parameters.length === 1 &&
      parameters[0]?.[0] === "v" &&
      parameters[0]?.[1] === videoId
    );
  } catch {
    return false;
  }
}

export async function probeYouTubeVideoOrientation(
  videoId: string,
  dependencies: { readHttp?: typeof readFeedHttp } = {},
): Promise<YouTubeProbeResult> {
  if (!YOUTUBE_VIDEO_ID.test(videoId)) {
    return { orientation: null, rateLimited: false };
  }

  const readHttp = dependencies.readHttp ?? readFeedHttp;
  const shortsUrl = `https://www.youtube.com/shorts/${videoId}`;

  try {
    const shortsResponse = await readHttp(shortsUrl, {
      followRedirects: false,
      method: "HEAD",
      totalDurationMs: YOUTUBE_PROBE_TIMEOUT_MS,
    });

    if (shortsResponse.status === 429) {
      return { orientation: null, rateLimited: true };
    }

    if (isExactWatchRedirect(shortsResponse, shortsUrl, videoId)) {
      return { orientation: "horizontal", rateLimited: false };
    }

    if (shortsResponse.status !== 200) {
      return { orientation: null, rateLimited: false };
    }

    // The Shorts route also returns 200 for unavailable IDs. oEmbed is used
    // only as a keyless existence check, never as orientation evidence.
    const oEmbedUrl = new URL("https://www.youtube.com/oembed");
    oEmbedUrl.searchParams.set(
      "url",
      `https://www.youtube.com/watch?v=${videoId}`,
    );
    oEmbedUrl.searchParams.set("format", "json");
    const oEmbedResponse = await readHttp(oEmbedUrl.toString(), {
      followRedirects: false,
      method: "HEAD",
      totalDurationMs: YOUTUBE_PROBE_TIMEOUT_MS,
    });

    if (oEmbedResponse.status === 429) {
      return { orientation: null, rateLimited: true };
    }

    return {
      orientation: oEmbedResponse.status === 200 ? "vertical" : null,
      rateLimited: false,
    };
  } catch {
    return { orientation: null, rateLimited: false };
  }
}

export function createYouTubeOrientationProbeStore(
  database: typeof Database,
): YouTubeOrientationProbeStore {
  return {
    async getClassifications(videoIds) {
      if (videoIds.length === 0) return [];
      return dbSemaphore.run(() =>
        database
          .select()
          .from(youtubeVideoClassifications)
          .where(inArray(youtubeVideoClassifications.videoId, videoIds))
          .all(),
      );
    },
    async getCooldownUntil() {
      const row = await dbSemaphore.run(() =>
        database
          .select({ value: appConfig.value })
          .from(appConfig)
          .where(eq(appConfig.key, YOUTUBE_COOLDOWN_CONFIG_KEY))
          .get(),
      );
      const timestamp = Number(row?.value);
      return Number.isFinite(timestamp) ? new Date(timestamp) : null;
    },
    async setClassification(value) {
      await dbSemaphore.run(() =>
        database
          .insert(youtubeVideoClassifications)
          .values(value)
          .onConflictDoUpdate({
            target: youtubeVideoClassifications.videoId,
            set: {
              classifiedAt: value.classifiedAt,
              orientation: value.orientation,
            },
          }),
      );
    },
    async setCooldownUntil(value) {
      await dbSemaphore.run(() =>
        database
          .insert(appConfig)
          .values({
            key: YOUTUBE_COOLDOWN_CONFIG_KEY,
            value: String(value.getTime()),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: appConfig.key,
            set: {
              value: sql<string>`CAST(MAX(CAST(${appConfig.value} AS INTEGER), ${value.getTime()}) AS TEXT)`,
              updatedAt: new Date(),
            },
          }),
      );
    },
  };
}

/**
 * Coordinates a single feed-refresh invocation. Its semaphore is deliberately
 * process-local; the database-backed 429 cooldown is the cross-invocation
 * circuit breaker used by serverless and multi-instance deployments.
 */
export class YouTubeOrientationProbeRun {
  private readonly cached = new Map<string, CachedYouTubeOrientation>();
  private readonly loadedVideoIds = new Set<string>();
  private readonly inFlight = new Map<
    string,
    Promise<YouTubeOrientationOutcome>
  >();
  private readonly limiter: Semaphore;
  private readonly maxNetworkVideos: number;
  private readonly now: () => Date;
  private readonly probe: (videoId: string) => Promise<YouTubeProbeResult>;
  private circuitBroken = false;
  private networkVideos = 0;
  private cooldownPromise: Promise<Date | null> | null = null;

  constructor(
    private readonly store: YouTubeOrientationProbeStore,
    options: YouTubeOrientationProbeRunOptions = {},
  ) {
    this.limiter = new Semaphore(
      options.maxConcurrentRequests ?? YOUTUBE_PROBE_CONCURRENCY_PER_RUN,
    );
    this.maxNetworkVideos =
      options.maxNetworkVideos ?? YOUTUBE_PROBE_MAX_VIDEOS_PER_RUN;
    this.now = options.now ?? (() => new Date());
    this.probe = options.probe ?? probeYouTubeVideoOrientation;
  }

  private async cooldownIsActive() {
    try {
      this.cooldownPromise ??= this.store.getCooldownUntil();
      const cooldownUntil = await this.cooldownPromise;
      return cooldownUntil !== null && cooldownUntil > this.now();
    } catch (error) {
      // If shared cooldown state cannot be read, skip optional probes rather
      // than risking an unbounded burst while the database is unhealthy.
      this.circuitBroken = true;
      logWarning("[YouTube Shorts] Failed to read probe cooldown", error);
      return true;
    }
  }

  private async loadCached(videoIds: string[]) {
    const unloaded = videoIds.filter(
      (videoId) => !this.loadedVideoIds.has(videoId),
    );
    if (unloaded.length === 0) return;
    unloaded.forEach((videoId) => this.loadedVideoIds.add(videoId));

    try {
      const rows = await this.store.getClassifications(unloaded);
      const freshAfter =
        this.now().getTime() - YOUTUBE_CLASSIFICATION_CACHE_TTL_MS;
      rows.forEach((row) => {
        if (row.classifiedAt.getTime() > freshAfter) {
          this.cached.set(row.videoId, row);
        }
      });
    } catch (error) {
      logWarning(
        "[YouTube Shorts] Failed to read cached classifications",
        error,
      );
    }
  }

  private classifyVideoId(videoId: string) {
    const existing = this.inFlight.get(videoId);
    if (existing) return existing;

    const promise = this.classifyUncachedVideoId(videoId).finally(() => {
      this.inFlight.delete(videoId);
    });
    this.inFlight.set(videoId, promise);
    return promise;
  }

  private async classifyUncachedVideoId(
    videoId: string,
  ): Promise<YouTubeOrientationOutcome> {
    const cached = this.cached.get(videoId);
    if (cached) {
      return {
        attempted: false,
        checkedAt: cached.classifiedAt,
        orientation: cached.orientation,
      };
    }

    if (this.circuitBroken || (await this.cooldownIsActive())) {
      return { attempted: false, checkedAt: null, orientation: null };
    }

    const probeResult = await this.limiter.run(async () => {
      // Reserve the budget only after entering the limiter. Otherwise a large
      // Promise.all can have every task observe the same pre-await counter and
      // collectively exceed the per-run network cap.
      if (this.circuitBroken || this.networkVideos >= this.maxNetworkVideos) {
        return null;
      }
      this.networkVideos++;
      return this.probe(videoId);
    });
    if (!probeResult) {
      return { attempted: false, checkedAt: null, orientation: null };
    }

    const checkedAt = this.now();
    if (probeResult.rateLimited) {
      this.circuitBroken = true;
      const cooldownUntil = new Date(
        checkedAt.getTime() + YOUTUBE_PROBE_RATE_LIMIT_COOLDOWN_MS,
      );
      try {
        await this.store.setCooldownUntil(cooldownUntil);
      } catch (error) {
        logWarning("[YouTube Shorts] Failed to persist probe cooldown", error);
      }
      return { attempted: true, checkedAt, orientation: null };
    }

    if (probeResult.orientation) {
      const cachedValue: CachedYouTubeOrientation = {
        classifiedAt: checkedAt,
        orientation: probeResult.orientation,
        videoId,
      };
      this.cached.set(videoId, cachedValue);
      try {
        await this.store.setClassification(cachedValue);
      } catch (error) {
        logWarning(
          "[YouTube Shorts] Failed to cache video classification",
          error,
        );
      }
    }

    return {
      attempted: true,
      checkedAt,
      orientation: probeResult.orientation,
    };
  }

  async classifyUrls(values: string[]) {
    const references = new Map(
      values.map((value) => [value, parseYouTubeVideoUrl(value)]),
    );
    const watchVideoIds = Array.from(
      new Set(
        Array.from(references.values()).flatMap((reference) =>
          reference?.kind === "watch" ? [reference.videoId] : [],
        ),
      ),
    );
    await this.loadCached(watchVideoIds);

    const outcomes = new Map<string, YouTubeOrientationOutcome>();
    await Promise.all(
      Array.from(references.entries()).map(async ([value, reference]) => {
        if (reference?.kind === "shorts") {
          outcomes.set(value, {
            attempted: false,
            checkedAt: null,
            orientation: "vertical",
          });
          return;
        }
        if (reference?.kind === "watch") {
          outcomes.set(value, await this.classifyVideoId(reference.videoId));
          return;
        }
        outcomes.set(value, {
          attempted: false,
          checkedAt: null,
          orientation: null,
        });
      }),
    );
    return outcomes;
  }
}

export function createYouTubeOrientationProbeRun(
  database: typeof Database,
  options?: YouTubeOrientationProbeRunOptions,
) {
  return new YouTubeOrientationProbeRun(
    createYouTubeOrientationProbeStore(database),
    options,
  );
}
