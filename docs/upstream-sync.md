# Upstream sync runbook

Serial's fork is synchronized with upstream by merge commit. Do not rebase or
squash the fork's public history: preserving both parents lets later syncs use
Git ancestry to identify only new upstream work.

## Migration lineage

Deployed fork migrations are immutable. Never replace, rename, renumber, edit,
or retimestamp a migration, snapshot, journal entry, or post-migration after it
has shipped. In particular, `0048_breezy_layla_miller` is the fork's canonical
`0048` and must remain unchanged.

When an upstream sync contains migrations that overlap a deployed fork number:

1. Merge the final upstream and fork schema definitions.
2. Restore the fork's migration journal and snapshots unchanged through the
   last deployed fork migration.
3. Generate the next fork-local migration from that snapshot and combined
   schema. Do not keep two migrations with the same number.
4. Port upstream post-migrations to the new tag in dependency order. Keeping
   them in the matching directory makes the migration runner execute schema and
   data changes in one transaction.
5. Test both a fresh database and an upgrade from the last deployed fork
   migration. Verify the journal/snapshot chain, preserved data, backfills, and
   a second no-op startup.

An upstream-only database that already applied the conflicting upstream
migration is not part of the supported lineage unless a later sync explicitly
adds and tests a reconciliation migration for it.

## Sync checklist

- Pin and fetch the reviewed upstream commit; do not advance the target during
  conflict resolution.
- Create an integration branch from fork `main` and merge with `--no-ff`.
- Review all files changed on both sides, including auto-merged files.
- Regenerate the lockfile with the repository's pinned pnpm version.
- Run the frozen install, formatting, lint, typecheck, unit/E2E tests, and every
  supported artifact build before promotion.
- Test additive migrations against a disposable clone or provider-native branch
  of the live database before deployment.
