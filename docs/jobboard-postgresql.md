# Job Board: PostgreSQL hooks consumer

Replaces only `lom2_listed_jobs` PocketBase realtime subscription/writeback. All unrelated PocketBase integrations and credentials remain unchanged. Counterpart: Team-Sneakymouse/psql-hooks PR #1 (merged); plugin must use PostgreSQL with trigger capture enabled.

## Required production configuration

- `JOBBOARD_HOOKS_URL=https://hooks.danidipp.com` — credential-free HTTPS origin, never a PostgreSQL URL.
- `JOBBOARD_INTERNAL_SECRET` — same server-side secret as hooks `INTERNAL_WEBHOOK_SECRET`. Never expose it in Discord or commit it.
- `JOBBOARD_STATE_DIR=/data/jobboard` — absolute path to a **persistent mounted volume**, writable by the bot, private to the deployment. Do not use ephemeral container storage. Directory/files are created with 0700/0600 permissions.
- Exactly **one active bot consumer** for this channel/identity; keep the same journal across restarts and releases. Multiple independent state directories are unsafe for uncertain-send deduplication. Do not delete or restore an older journal without manual reconciliation.
- Discord bot needs View Channel, Read Message History, Send Messages, Embed Links and Attach Files in channel `1233508899630481408`.

No deployment or secret changes are performed by this PR. Missing/unsafe configuration throws explicitly at feature initialization. State-directory failures log a startup failure and never start claims. Configure variables/mount before deploying. Bot still needs its existing PocketBase settings for other features.

## HTTP contract

All calls use HTTPS, `X-Internal-Secret`, JSON, redirects disabled and a 10s deadline including response body reads. Requests are aborted at shutdown.

1. `POST /internal/lom/jobs/discord/claim` with `{"limit":1}`.
2. Validate `{items:[{eventId:string,leaseToken:string,kind:"create"|"end",job:JobData}],hasMore:boolean}`. Only exact port50001 is accepted; missing/zero/foreign ports fail closed. Snapshot timestamps are numeric epoch milliseconds. No DB credentials.
3. Process at most one event per poll; then `POST /internal/lom/jobs/discord/ack` with `{eventId,leaseToken,discordMessageId?}`. Validate `{ok:true}`. Any HTTP failure (including stale lease409) leaves work for hooks expiry/retry, never a PB writeback or full-row upsert.

Polling waits 5s after completion, never overlaps. Hooks lease is120s; Discord operation waits are bounded15s and further actions stop after90s of event processing. Calls already dispatched to Discord cannot be cancelled by a Promise deadline; the durable reservation fences any subsequent send. Slow/error cases surface logs, not blind resend. Feature shutdown removes its readiness handler, aborts HTTP and awaits bounded in-flight polling. `Lom2JobBoard` returns an async stop function; `bot.ts` owns SIGINT/SIGTERM, awaits this stop, closes HTTP/Discord/PocketBase connections, and exits. A 30s process deadline forces exit if cleanup hangs.

## Uncertain send / recovery policy

Each create message has literal content `[lom-job:<record-id>]`; original embed/map/PNG attachment are retained. Before sending, an exclusive per-job `.reserved` file is written and fsynced (including directory). After a confirmed send, `.sent` durably stores the message ID **before ack**. A successful send followed by failed ack retries only the acknowledgement, without reposting.

For reconciliation, use canonical snapshot message ID or durable journal ID, otherwise inspect the last100 channel messages for this bot's exact marker. Recovered markers are durably journaled before ack. A reservation without a known or discoverable message **blocks reposting**, even if history returns no match. History is bounded: absence from100 messages is not proof that a previous send failed. A send that completed after timeout may appear later and be recovered on a later lease.

If logged `manual reconciliation required`, operators must inspect full Discord history and journal/backups. If a message exists, confirm its author/job marker and repair the job's `.sent` file with its decimal ID using an operator-controlled durable write. If confirmed absent, stop the consumer and establish that no request remains in flight before deliberately removing only that job's reservation to authorize a new send. Do not clear reservations in bulk. Corrupt journals fail closed. There is no exactly-once transaction across Discord and PostgreSQL.

End events update the existing message to gray/Expired while retaining its thumbnail attachment and removing the map URL; deleted jobs delete the message. Missing Discord messages (Unknown Message10008) are acknowledged, not recreated. Other Discord errors retry. End events with no canonical/journal/marker message are acknowledged without creating a new historical message. Hooks FIFO makes ended-before-claim jobs process create before end.

## Verification

Tests cover exact-port validation, config/body failures, exact HTTP claim/ack payloads, stale-lease/server errors, send→ack failure, durable restart reservations, bounded-history reconciliation, create→end ordering, attachment/map/expire/delete behavior, missing Discord messages, nonoverlapping polling and shutdown guards. Discord and HTTP boundaries are test doubles; no live Discord/PB/PostgreSQL writes or deployment tests are claimed.

Full suite has two **pre-existing** `PluginChangelog.test.ts` assertion failures, reproduced at unchanged base commit `c64e8bb` in an isolated worktree. PocketBase integration tests are skipped without the opt-in test service. Keep these separate from job-board verification; do not change unrelated changelog behavior in this migration.
