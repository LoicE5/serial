import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it } from "vitest";

const MIGRATIONS_DIRECTORY = "src/server/db/migrations";
const META_DIRECTORY = `${MIGRATIONS_DIRECTORY}/meta`;
const POST_MIGRATIONS_DIRECTORY = "src/server/db/post-migrations";
const FORK_MIGRATION_TAG = "0048_breezy_layla_miller";
const COMBINED_MIGRATION_TAG = "0049_broad_tombstone";

type JournalEntry = {
  idx: number;
  tag: string;
  when: number;
};

type Journal = {
  entries: JournalEntry[];
};

type TestClient = ReturnType<typeof createClient>;

function readJournal(): Journal {
  return JSON.parse(
    readFileSync(`${META_DIRECTORY}/_journal.json`, "utf8"),
  ) as Journal;
}

function statements(content: string) {
  return content
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function readPostMigrationStatements(tag: string) {
  try {
    return readdirSync(`${POST_MIGRATIONS_DIRECTORY}/${tag}`)
      .filter((fileName) => fileName.endsWith(".sql"))
      .sort()
      .flatMap((fileName) =>
        statements(
          readFileSync(
            `${POST_MIGRATIONS_DIRECTORY}/${tag}/${fileName}`,
            "utf8",
          ),
        ),
      );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function ensureMigrationTable(client: TestClient) {
  await client.execute(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash text NOT NULL,
    created_at numeric
  )`);
}

async function runPendingMigrations(
  client: TestClient,
  entries: JournalEntry[],
) {
  await ensureMigrationTable(client);
  const latest = await client.execute(
    "SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
  );
  const lastAppliedAt = Number(latest.rows[0]?.created_at ?? 0);
  const pending = entries.filter((entry) => entry.when > lastAppliedAt);

  for (const entry of pending) {
    const migration = readFileSync(
      `${MIGRATIONS_DIRECTORY}/${entry.tag}.sql`,
      "utf8",
    );
    const hash = createHash("sha256").update(migration).digest("hex");
    await client.batch(
      [
        ...statements(migration),
        ...readPostMigrationStatements(entry.tag),
        {
          sql: "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
          args: [hash, entry.when],
        },
      ],
      "write",
    );
  }

  return pending.length;
}

function names(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => String(row.name));
}

describe("migration chain", () => {
  const cleanupDirectories: string[] = [];

  afterEach(() => {
    for (const directory of cleanupDirectories.splice(0)) {
      rmSync(directory, { recursive: true });
    }
  });

  it("has one sequential lineage with valid snapshots and post-migration tags", () => {
    const { entries } = readJournal();
    const tags = entries.map((entry) => entry.tag);

    expect(new Set(tags).size).toBe(tags.length);
    expect(entries.at(-2)?.tag).toBe(FORK_MIGRATION_TAG);
    expect(entries.at(-1)?.tag).toBe(COMBINED_MIGRATION_TAG);
    expect(entries.map((entry) => entry.idx)).toEqual(
      entries.map((_, index) => index),
    );
    expect(
      entries.every(
        (entry, index) =>
          entry.tag.startsWith(String(index).padStart(4, "0")) &&
          (index === 0 || entry.when > entries[index - 1]!.when),
      ),
    ).toBe(true);

    const migrationFiles = readdirSync(MIGRATIONS_DIRECTORY)
      .filter((fileName) => fileName.endsWith(".sql"))
      .sort();
    expect(migrationFiles).toEqual(tags.map((tag) => `${tag}.sql`).sort());

    const postMigrationTags = readdirSync(POST_MIGRATIONS_DIRECTORY, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(postMigrationTags.every((tag) => tags.includes(tag))).toBe(true);
    expect(postMigrationTags).not.toContain("0048_normal_stryfe");

    const snapshotIds = new Set<string>();
    let previousId: string | undefined;
    for (const entry of entries) {
      const snapshot = JSON.parse(
        readFileSync(
          `${META_DIRECTORY}/${String(entry.idx).padStart(4, "0")}_snapshot.json`,
          "utf8",
        ),
      ) as { id: string; prevId: string };
      expect(snapshotIds.has(snapshot.id)).toBe(false);
      snapshotIds.add(snapshot.id);
      if (previousId !== undefined) expect(snapshot.prevId).toBe(previousId);
      previousId = snapshot.id;
    }
  });

  it("applies the complete combined chain to a fresh database and is idempotent", async () => {
    const directory = mkdtempSync(join(tmpdir(), "serial-migration-chain-"));
    cleanupDirectories.push(directory);
    const client = createClient({ url: `file:${directory}/database.sqlite` });
    const { entries } = readJournal();

    try {
      expect(await runPendingMigrations(client, entries)).toBe(entries.length);

      const tables = names(
        (
          await client.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
          )
        ).rows,
      );
      expect(tables).toEqual(
        expect.arrayContaining([
          "serial_atproto_auth_state",
          "serial_atproto_connections",
          "serial_user",
          "serial_youtube_video_classification",
        ]),
      );
      expect(
        names((await client.execute("PRAGMA table_info(serial_user)")).rows),
      ).toContain("email_verification_exempt");
      expect(
        names(
          (await client.execute("PRAGMA index_list(serial_atproto_auth_state)"))
            .rows,
        ),
      ).toContain("atproto_auth_state_expires_at_idx");
      expect(
        names(
          (
            await client.execute(
              "PRAGMA index_list(serial_atproto_connections)",
            )
          ).rows,
        ),
      ).toEqual(
        expect.arrayContaining([
          "serial_atproto_connections_did_unique",
          "serial_atproto_connections_user_id_unique",
        ]),
      );
      expect(
        (
          await client.execute(
            "PRAGMA foreign_key_list(serial_atproto_connections)",
          )
        ).rows,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            from: "user_id",
            on_delete: "CASCADE",
            table: "serial_user",
            to: "id",
          }),
        ]),
      );

      const records = await client.execute(
        "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at",
      );
      expect(records.rows).toHaveLength(entries.length);
      expect(records.rows.map((row) => Number(row.created_at))).toEqual(
        entries.map((entry) => entry.when),
      );
      expect(records.rows.every((row) => String(row.hash).length === 64)).toBe(
        true,
      );

      expect(await runPendingMigrations(client, entries)).toBe(0);
      expect(
        (
          await client.execute(
            "SELECT COUNT(*) AS count FROM __drizzle_migrations",
          )
        ).rows[0]?.count,
      ).toBe(entries.length);
    } finally {
      client.close();
    }
  }, 15_000);

  it("upgrades a seeded fork 0048 database without changing existing data", async () => {
    const directory = mkdtempSync(join(tmpdir(), "serial-0048-upgrade-"));
    cleanupDirectories.push(directory);
    const client = createClient({ url: `file:${directory}/database.sqlite` });
    const { entries } = readJournal();
    const throughFork0048 = entries.filter((entry) => entry.idx <= 48);
    const createdAt = 1_700_000_000;
    const updatedAt = 1_700_000_100;

    try {
      expect(await runPendingMigrations(client, throughFork0048)).toBe(49);

      for (const [id, email] of [
        ["credential-user", "credential@example.com"],
        ["identity-user", "identity@example.com"],
        ["accountless-user", "accountless@example.com"],
      ] as const) {
        await client.execute({
          sql: `INSERT INTO serial_user
            (id, name, email, email_verified, created_at, updated_at)
            VALUES (?, ?, ?, 0, ?, ?)`,
          args: [id, id, email, createdAt, updatedAt],
        });
      }
      for (const [id, providerId, userId] of [
        ["credential-account", "credential", "credential-user"],
        ["identity-account", "github", "identity-user"],
      ] as const) {
        await client.execute({
          sql: `INSERT INTO serial_account
            (id, account_id, provider_id, user_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
          args: [id, id, providerId, userId, createdAt, updatedAt],
        });
      }
      await client.execute({
        sql: `INSERT INTO serial_feed
          (id, user_id, name, url, platform, created_at, updated_at)
          VALUES (7, 'credential-user', 'YouTube',
            'https://www.youtube.com/feeds/videos.xml?channel_id=example',
            'youtube', ?, ?)`,
        args: [createdAt, updatedAt],
      });
      await client.execute({
        sql: `INSERT INTO serial_feed_item
          (id, feed_id, content_id, title, author, url, content_type,
           orientation, orientation_checked_at, posted_at, created_at, updated_at)
          VALUES ('seed-item', 7, 'video-id', 'Seed item', 'Author',
            'https://www.youtube.com/shorts/seed-video', 'video', 'vertical',
            ?, ?, ?, ?)`,
        args: [updatedAt, createdAt, createdAt, updatedAt],
      });
      await client.execute({
        sql: `INSERT INTO serial_youtube_video_classification
          (video_id, orientation, classified_at)
          VALUES ('seed-video1', 'vertical', ?)`,
        args: [updatedAt],
      });

      const preservedQueries = [
        "SELECT id, name, email, email_verified, created_at, updated_at FROM serial_user ORDER BY id",
        "SELECT id, account_id, provider_id, user_id, created_at, updated_at FROM serial_account ORDER BY id",
        "SELECT id, user_id, name, url, platform, created_at, updated_at FROM serial_feed ORDER BY id",
        `SELECT id, feed_id, content_id, orientation, orientation_checked_at,
          posted_at, created_at, updated_at FROM serial_feed_item ORDER BY id`,
        "SELECT video_id, orientation, classified_at FROM serial_youtube_video_classification ORDER BY video_id",
      ];
      const before = await Promise.all(
        preservedQueries.map(async (sql) => (await client.execute(sql)).rows),
      );

      expect(await runPendingMigrations(client, entries)).toBe(1);

      const after = await Promise.all(
        preservedQueries.map(async (sql) => (await client.execute(sql)).rows),
      );
      expect(after).toEqual(before);
      expect(
        (
          await client.execute(
            `SELECT id, email_verification_exempt
             FROM serial_user ORDER BY id`,
          )
        ).rows,
      ).toEqual([
        { id: "accountless-user", email_verification_exempt: 0 },
        { id: "credential-user", email_verification_exempt: 0 },
        { id: "identity-user", email_verification_exempt: 1 },
      ]);
      expect(
        (
          await client.execute(
            "SELECT COUNT(*) AS count FROM serial_atproto_connections",
          )
        ).rows[0]?.count,
      ).toBe(0);
      expect(
        (
          await client.execute(
            "SELECT COUNT(*) AS count FROM __drizzle_migrations",
          )
        ).rows[0]?.count,
      ).toBe(entries.length);

      expect(await runPendingMigrations(client, entries)).toBe(0);
      const afterSecondStartup = await Promise.all(
        preservedQueries.map(async (sql) => (await client.execute(sql)).rows),
      );
      expect(afterSecondStartup).toEqual(before);
    } finally {
      client.close();
    }
  }, 15_000);
});
