# Push tracking

Every push to a Team-Sneakymouse repository's default branch gets exactly one
message in the [dev update thread](https://discord.com/channels/391355330241757205/1561330944395313255).
The bot edits that message as the push moves through CI, publishing, dev-server
deployment and container updates. Code: `src/PushTracking/`.

```
push ──► CI (workflow_run) ──┬─► published to Reposilite ─► deployed to dev servers   (plugins)
                             ├─► image built ─► Watchtower updated container          (Docker repos)
                             └─► done (CI only)                                        (everything else)
```

`/plugins update` keeps its own progress message and is not shown here.

## Message

Each message is a container whose accent color shows the current state:

```
┃ SneakyMail · DaniDipp · compare
┃ - abc1234 Fix mail delivery
┃ ───────────────
┃ ✅ CI · Build and publish — success
┃ ✅ Uploaded SneakyMail 2026.10.29-abc1234 to Dev one, Dev two.
```

- Color is the overall state: blurple pushed, blue in progress, green done,
  red if any stage failed, gray if superseded by a force push. A push deployed
  together with a later one is green.
- The header has the repository name (without the organization), the pusher and
  the compare link. Without a compare link (push details still missing) it links
  the head commit instead.
- Below the divider is one line per stage, in a fixed order: CI workflows, then
  dev-server deployments, then containers. A stage updates its line in place (a
  re-run shows `(attempt 2)`).
- Commits are listed oldest first. When they exceed the 4,000-character limit
  of a container message, the oldest are hidden behind "…N earlier commit(s)", which links
  to the comparison. Mentions are disabled and subjects are escaped.
- Dependabot and other bot pushes are tracked like any other push.
- When a deployment also ships earlier pushes whose own builds failed or were
  skipped, those messages say "Deployed together with a later push" and link to it.
  Pushes on a non-forced branch form a chain through GitHub's `before` SHA.
- A force push marks earlier pushes that never deployed as superseded.
- Messages sent as plain text before the container format are converted on their
  next edit; they are not migrated otherwise.

Messages are re-rendered from the database, never patched, so replayed and
out-of-order events are harmless. A render loop runs every second and edits only
pushes that changed, so bursts of events become one edit. A deleted message
(Unknown Message) is sent again. Other Discord errors retry with backoff of up to
five minutes and never create a duplicate.

## Event sources

| Stage | Source | Matched by |
|---|---|---|
| Pushed | GitHub `push` → `POST /github` | repo + `after` |
| CI | GitHub `workflow_run` → `POST /github` | repo + `head_sha`; one line per workflow |
| Dev deployment | Reposilite worker ([reposilite-webhook.md](reposilite-webhook.md)) | POM repo + commit prefix |
| Container | Watchtower → `POST /watchtower` | image labels: `ociSource` + `latestImageRevision` |
| This bot's container | `GIT_SHA` at startup | `Team-Sneakymouse/Mother-Mouse-Discord` + `GIT_SHA` |

Events may arrive in any order. A workflow run can create the push before the push
event fills in its commits ("Waiting for push details from GitHub"). Repository
names match case-insensitively; release versions carry 7-character hashes, which
are matched as SHA prefixes.

Updates that match no tracked push still get a message. Reposilite uploads use
their own per-upload message, as before. Watchtower updates of untracked images get
a one-line "Updated container" message. If the database is unavailable, the
Reposilite worker also falls back to its own message; tracking never blocks a
deployment.

Missed deliveries are not recovered automatically. GitHub can redeliver them by
hand (webhook settings → Recent Deliveries). Deliveries are deduplicated by
`X-GitHub-Delivery` for 30 days. A delivery that fails to process is released, so a
redelivery is accepted.

## GitHub webhook

Organization webhook → `https://mm-discord.rawb.tv/github`, content type
`application/json`, secret `GITHUB_WEBHOOK_SECRET`, events **Pushes** and
**Workflow runs**.

- `X-Hub-Signature-256` is verified over the raw body before parsing. That's why
  the route is registered before the bot's global `express.json()`.
- `ping` → 200; other events → 204; bad signature → 401; malformed payload → 400;
  duplicate delivery → 200; accepted → 202; missing secret or database → 503.
- Only pushes to `refs/heads/<default branch>` are tracked; branch deletions and
  tags are ignored. Only workflow runs with `event: push` on the default branch are
  tracked.
- Private repository names and commit subjects are visible to everyone who can
  read the thread. Access is managed in Discord.

## Docker / Watchtower

Verified on 2026-10-29 with a local registry, a buildx build with provenance (as CI
produces) and `nickfedor/watchtower:latest` (1.23.x).

- The shared CI workflow (`Team-Sneakymouse/ci`, `docker-deploy.yml`) labels every
  image with `org.opencontainers.image.revision` (commit SHA) and
  `org.opencontainers.image.source` (repo URL), and passes build arg `GIT_SHA`.
  No image-to-repo mapping is maintained.
- Watchtower **v1.23.0 or later** reads those labels itself and includes them in its
  JSON report, so the bot needs no registry access.
- Watchtower stops this bot before the new container is listening, so its report
  about the bot is lost. The Dockerfile turns `GIT_SHA` into an environment
  variable, and the bot marks its own push as "container updated" when it starts.

Watchtower settings (`/docker/watchtower/docker-compose.yml` on alphaarcadeus),
replacing the current `discord://` notification URL:

```yaml
WATCHTOWER_NOTIFICATION_REPORT: "true"
WATCHTOWER_NOTIFICATION_TEMPLATE: json.v1
WATCHTOWER_NOTIFICATION_URL: generic+https://mm-discord.rawb.tv/watchtower?@Authorization=Bearer+<WATCHTOWER_WEBHOOK_TOKEN>
```

`@Authorization` becomes a request header. The body is JSON sent as `text/plain`.
`report.updated[]` and `report.failed[]` are used; notifications without a report
(startup) are ignored.

## Storage

PostgreSQL through Bun's built-in client (`Bun.sql`), configured by `PGHOST`,
`PGUSER`, `PGPASSWORD`, `PGDATABASE` (and optionally `PGPORT`). Everything lives in
schema `discord_push_tracking`. Numbered migrations
(`discord_push_tracking.migrations`, guarded by an advisory lock) create and update
its tables at startup.

The bot logs in as `mothermouse`, a member of the group role `mothermouse_rw`,
which holds read/write access to the bot's data across schemas. `mothermouse` has
no `CREATE` privilege on the database, so the schema was created once by the
database administrator (done on 2026-10-29), owned by `mothermouse`:

```sql
-- as postgres, in database team_sneakymouse
create schema discord_push_tracking authorization mothermouse;
grant usage on schema discord_push_tracking to mothermouse_rw;
```

The bot then manages everything inside it. Existing default privileges give
`mothermouse_rw` read/write access to every table and sequence that `mothermouse`
creates, as in the other schemas. The bot only tries to create the schema if it is
missing, because even `create schema if not exists` requires the database
privilege. Without the schema, startup logs the command to run and tracking stays
disabled.

- `deliveries`: webhook delivery IDs for deduplication, pruned after 30 days.
- `pushes`: one row per repo + SHA, with commits, the Discord message ID, and
  `version` / `rendered_version` counters. Every change increments `version`, and
  rows with `version > rendered_version` get rendered, so pending edits survive
  restarts.
- `stages`: one row per push + kind + key, with status and details.

Without `PGHOST` the feature is disabled and the routes return 503. Database setup
failures are logged and also disable it.

## Configuration

| Variable | Purpose |
|---|---|
| `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | Database (already in `/MotherMouse`) |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook secret |
| `WATCHTOWER_WEBHOOK_TOKEN` | Bearer token in Watchtower's notification URL |
| `GIT_SHA` | Set by CI at build time; nothing to configure |

The bot posts in the same thread as before, with the same permissions.

## Rollout

1. Merge the `ci` change (image labels and `GIT_SHA`) so new images carry them.
2. ~~Create the `discord_push_tracking` schema~~ (done; see [Storage](#storage)).
   Add `GITHUB_WEBHOOK_SECRET` and `WATCHTOWER_WEBHOOK_TOKEN` to Infisical
   `/MotherMouse`, then deploy the bot.
3. Create the organization webhook (above) and check that the ping succeeds.
4. Update Watchtower to ≥ 1.23 and switch its notification settings (above).
5. Push a commit to a plugin repo and to a Docker repo, and follow both messages.

## Verification

```sh
bun test tests/PushTracking.test.ts tests/PushTrackingStore.test.ts tests/ReposiliteWebhook.test.ts
bun run typecheck
```

`tests/PushTrackingStore.test.ts` tests the PostgreSQL store only when
`PUSH_TRACKING_TEST_DATABASE_URL` points at a **disposable** database (it drops the
`discord_push_tracking` schema), e.g. a local `postgres:17-alpine` container. It passes
every connection setting explicitly so the PG variables in `.env` cannot redirect
it.
