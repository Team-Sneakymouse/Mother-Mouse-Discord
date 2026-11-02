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
  resource owner **Team-Sneakymouse**, **all repositories**, **Pull requests: Read
  and write** (write is needed for the Merge buttons), **Contents: Read and write**
  (merging requires it) and the automatically included **Metadata: Read** permission. Obtain organization
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
Each PR is a Components V2 section with its link on the left and a **Merge** button
on the right (disabled for drafts). Mentions are disabled. Long text is safely
shortened; complete PR links are retained. Messages respect the Components V2 limits
(40 components, 4,000 characters of text), so about 12 PRs fit per message, and
repository headings repeat across messages.
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

## Merge buttons

The button custom id is `ghpr-merge:<repo>:<number>` (the organization is implied);
the bot keeps no state, so buttons keep working across restarts. A repository name
too long for the 100-character custom id is cut and marked `~`; on click the bot
looks up the organization's repositories and merges only if exactly one name
starts with that prefix, otherwise it refuses and says so.

Members with the **Tech Team** role (`816744626751799366`) or the Administrator
permission may merge. Clicking merges the PR with GitHub's default merge method and
edits the digest message in place: only that button is replaced by a grey, disabled
**Merged by <user>**. Other PRs in the digest are not refreshed, so a button can be
stale. Failures (not mergeable, conflicts, missing token permission, already
merged) are reported privately to the clicker and leave the message unchanged.

## New PR alerts

When a PR is opened in any Team-Sneakymouse repository, the bot posts a single-PR
message in the same channel: **New pull request in <repo>** followed by the same row
as in the digest (link, title, author, Merge or Open draft button). Only the
`opened` action is announced; reopened PRs, drafts marked ready and other actions are
not. PRs opened by Dependabot (`dependabot[bot]`) are not announced; they still
appear in the daily digest, which has no exclusions. Other bots are announced.

The alert arrives through the organization webhook that also drives push tracking
(`POST /github`, see [push-tracking.md](push-tracking.md#github-webhook)), which
must have the **Pull requests** event enabled. It shares that route's signature check
and delivery deduplication, so it needs the push-tracking database; a redelivery
never posts twice. If posting to Discord fails, the delivery is released and returns
503, so it can be redelivered by hand from GitHub.

## New issue alerts

When an issue is opened in any Team-Sneakymouse repository, the bot posts
**New issue in <repo>** followed by the issue link, title and author in the same
channel. It has no buttons and the refresh command does not apply to it. Only the
`opened` action is announced. It uses the same webhook route, deduplication and
failure handling as PR alerts; the organization webhook must also have the
**Issues** event enabled.

## Refreshing a digest message

Works on digest messages and on new PR alerts.


Right-click a digest message → **Apps → Refresh PR status** (registered in the
RawbTV guild; run `registerCommands.ts` after deploying). Anyone may use it. Only
the clicked message is refreshed; other parts of the same digest are left alone.

Each PR row is identified by the PR link in its text, then its button is rebuilt
from GitHub's live state: **Merge** (open), **Open draft** (draft; the `[DRAFT]`
prefix follows the live state), grey disabled **Merged by <user>**, or red disabled
**Closed by <user>**. A row that already says *Merged by* is kept as is (merging is
final), so the Discord user recorded by the Merge button stays; otherwise the GitHub
login is used (`merged_by` of the PR, `closed_by` of its issue, which costs one
extra request per closed PR). Reopened PRs get their Merge button back.

Every lookup finishes before the message is edited; any GitHub failure leaves the
message untouched and is reported privately. The message is re-read just before the
edit so a Merge click during the lookups is not overwritten.

## Verification

```sh
bun test
bun run typecheck
bunx biome check src/GithubPrStatus.ts tests/GithubPrStatus.test.ts
```

Tests use fixtures and a loopback HTTP server, not production GitHub/Discord
credentials. After deployment, verify token repository coverage, destination
permissions, and the first scheduled noon-UTC delivery in production.
