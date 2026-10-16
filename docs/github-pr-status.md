# Daily GitHub PR digest

The production bot (`PRODUCTION=TRUE`) schedules a deterministic digest at **12:00
UTC every day** (`0 0 12 * * *`, explicit `Etc/UTC`; unaffected by DST). It starts
scheduling after Discord is ready, does not post on startup, and does not catch up
missed runs while offline. No LLM or external/Hermes cron is involved.

## Configuration and permissions

- Supply `GITHUB_TOKEN` through the existing production secret injection (see
  [Docker runtime secrets](docker-secrets.md)); local runs use dotenv. Never commit
  the token. A missing/blank token disables the digest and logs a configuration error.
- Prefer a fine-grained PAT owned by an account with access to Team-Sneakymouse,
  resource owner **Team-Sneakymouse**, **all repositories**, **Pull requests: Read**
  and the automatically included **Metadata: Read** permission. Obtain organization
  approval where required. A classic PAT needs `repo` for private repositories and
  SSO authorization if the organization requires it.
- The bot enumerates every repository GitHub exposes to that token, including
  private repositories, then all open PRs, including drafts. Token/account access
  determines coverage: repositories hidden from the token cannot be detected.
- Discord destination: **808030927937994772**. The bot needs View Channel and Send
  Messages there. **Private repository names, PR titles, authors and links will be
  visible to everyone who can read that channel**; ensure this audience is intended.

## Behavior and failures

Results are sorted by repository name and PR number and grouped by repository.
Drafts are marked, mentions are disabled, and link previews are suppressed. Long
text is safely shortened; complete PR links are retained. Messages respect the
2,000-character content limit and repeat repository headings across chunks.
Unchanged PRs are included again each day; an empty snapshot sends nothing.

Every repository/PR page is fetched and validated before sending anything. Any
GitHub failure (including authorization, rate limits, timeout or invalid response)
aborts the whole digest and logs a separate `GithubPrStatus: collection failed`
error, never an empty or partial snapshot. GitHub requests have a 15-second timeout
and redirects disabled. Raw error objects/headers are not logged to protect tokens.

Discord delivery is sequential, not atomic. Each message is labeled **Part X/N**
so an interrupted delivery is identifiable as incomplete; a delivery error logs
how many parts were sent and stops the remaining parts. There are no automatic
retries that might duplicate messages; the next day collects a fresh snapshot.
An in-process guard prevents overlapping runs. Run one production bot instance;
there is no distributed scheduler lock. GitHub pagination is not an atomic snapshot
if repositories/PRs change during collection.

## Verification

```sh
bun test
bun run typecheck
bunx biome check src/GithubPrStatus.ts tests/GithubPrStatus.test.ts
```

Tests use fixtures and a loopback HTTP server, not production GitHub/Discord
credentials. After deployment, verify token repository coverage, destination
permissions, and the first scheduled noon-UTC delivery in production.
