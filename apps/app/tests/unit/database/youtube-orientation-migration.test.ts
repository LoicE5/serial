import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it } from "vitest";

const MIGRATIONS_DIRECTORY = "src/server/db/migrations";
const MIGRATION_TAG = "0048_breezy_layla_miller";
const POST_MIGRATION =
  "src/server/db/post-migrations/0048_breezy_layla_miller/001_reset_youtube_feed_item_orientations.sql";

function statements(content: string) {
  return content
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe("YouTube feed-item orientation migration", () => {
  const cleanupDirectories: string[] = [];

  afterEach(() => {
    for (const directory of cleanupDirectories.splice(0)) {
      rmSync(directory, { recursive: true });
    }
  });

  it("invalidates only uncertain YouTube orientations without changing item state or timestamps", async () => {
    const directory = mkdtempSync(join(tmpdir(), "serial-youtube-migration-"));
    cleanupDirectories.push(directory);
    const client = createClient({ url: `file:${directory}/database.sqlite` });
    const journal = JSON.parse(
      readFileSync(`${MIGRATIONS_DIRECTORY}/meta/_journal.json`, "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };

    try {
      for (const entry of journal.entries.filter(({ idx }) => idx <= 47)) {
        for (const statement of statements(
          readFileSync(`${MIGRATIONS_DIRECTORY}/${entry.tag}.sql`, "utf8"),
        )) {
          await client.execute(statement);
        }
      }

      const createdAt = 1_700_000_000;
      const updatedAt = 1_700_000_100;
      const watchedAt = 1_700_000_200;
      const savedAt = 1_700_000_300;
      await client.execute({
        sql: `INSERT INTO serial_user
          (id, name, email, email_verified, created_at, updated_at)
          VALUES ('user-1', 'User', 'user@example.com', 1, ?, ?)`,
        args: [createdAt, updatedAt],
      });
      await client.execute({
        sql: `INSERT INTO serial_feed
          (id, user_id, name, url, platform, created_at, updated_at)
          VALUES (1, 'user-1', 'YouTube', 'https://youtube.example/feed', 'youtube', ?, ?)`,
        args: [createdAt, updatedAt],
      });
      await client.execute({
        sql: `INSERT INTO serial_feed
          (id, user_id, name, url, platform, created_at, updated_at)
          VALUES (2, 'user-1', 'PeerTube', 'https://peertube.example/feed', 'peertube', ?, ?)`,
        args: [createdAt, updatedAt],
      });

      for (const [id, feedId, url] of [
        ["youtube-watch", 1, "https://www.youtube.com/watch?v=PG_kfqOXqgQ"],
        ["youtube-short", 1, "https://www.youtube.com/shorts/PG_kfqOXqgQ"],
        ["peertube", 2, "https://peertube.example/w/abcdefghijklmnopqrstuv"],
      ] as const) {
        await client.execute({
          sql: `INSERT INTO serial_feed_item
            (id, feed_id, content_id, title, author, url, content_type,
             is_watched, is_watch_later, orientation, posted_at, created_at,
             updated_at, is_watched_updated_at, is_watch_later_updated_at)
            VALUES (?, ?, ?, ?, 'Author', ?, 'video', 1, 1, 'horizontal', ?, ?, ?, ?, ?)`,
          args: [
            id,
            feedId,
            id,
            id,
            url,
            createdAt,
            createdAt,
            updatedAt,
            watchedAt,
            savedAt,
          ],
        });
      }

      for (const statement of statements(
        readFileSync(`${MIGRATIONS_DIRECTORY}/${MIGRATION_TAG}.sql`, "utf8"),
      )) {
        await client.execute(statement);
      }
      for (const statement of statements(
        readFileSync(POST_MIGRATION, "utf8"),
      )) {
        await client.execute(statement);
      }

      expect(
        await client.execute(
          `SELECT id, orientation, orientation_checked_at, is_watched,
                  is_watch_later, created_at, updated_at,
                  is_watched_updated_at, is_watch_later_updated_at
           FROM serial_feed_item ORDER BY id`,
        ),
      ).toMatchObject({
        rows: [
          {
            id: "peertube",
            orientation: "horizontal",
            orientation_checked_at: null,
            is_watched: 1,
            is_watch_later: 1,
            created_at: createdAt,
            updated_at: updatedAt,
            is_watched_updated_at: watchedAt,
            is_watch_later_updated_at: savedAt,
          },
          {
            id: "youtube-short",
            orientation: "vertical",
            orientation_checked_at: null,
            is_watched: 1,
            is_watch_later: 1,
            created_at: createdAt,
            updated_at: updatedAt,
            is_watched_updated_at: watchedAt,
            is_watch_later_updated_at: savedAt,
          },
          {
            id: "youtube-watch",
            orientation: null,
            orientation_checked_at: null,
            is_watched: 1,
            is_watch_later: 1,
            created_at: createdAt,
            updated_at: updatedAt,
            is_watched_updated_at: watchedAt,
            is_watch_later_updated_at: savedAt,
          },
        ],
      });
    } finally {
      client.close();
    }
  });
});
