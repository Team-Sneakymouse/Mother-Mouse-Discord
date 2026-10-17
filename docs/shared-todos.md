# Shared todos: operator and developer guide

For `/todo manage`, user-assigned groups, `label:me`, and the reviewed catalog seed, see [Label and group management](todo-label-management.md).

This guide describes `src/Todo.ts`, `src/todo/`, the PocketBase hooks/schema, and the separately reviewed Hermes bridge. It is not a deployment record. Collection creation alone does not install hooks, activate Hermes, register Discord commands, or restart either service.

## Workflow and authorization

The integration is restricted to RAWBTV guild `391355330241757205`.
`/todo` defaults to Administrator, following the same Discord command-permission model as `/plugins update`: administrators can grant access to the intended developers through Discord application-command overrides. The controller relies on Discord authorizing command delivery; it does not independently check a Developer role. List/edit components additionally require the original list owner, this guild, and a message authored by this bot. Replies are ephemeral; the new work forum post is not.

`Create report` also defaults to Administrator. Review Discord application-command overrides for `/todo` and the context menu separately before rollout: shared defaults do not imply shared overrides. Node relies on Discord-authorized command delivery plus owner-bound component controls, not an independent Developer-role lookup. Hermes independently authorizes the actual human user through host policy.

### 1. Capture evidence

Right-click a message → Apps → **Create report**. This scripts capture; it does not call a model or start work.

The collector paginates the source channel's history, not its cache, then repeatedly includes:

- messages by the same sender within ±30 seconds of each included message;
- the parent of an included reply and replies to included messages;
- the same relationships recursively for newly included messages.

This is not a fixed ±30-second window around only the original message. Reply traversal is limited to the source channel. Discord has no reverse-reply lookup, so finding replies requires scanning history, including history newer than the original report. Defaults are 100 messages/page, 1,000 pages, 100,000 scanned messages and 5,000 included messages. Fetch failures, missing reply targets, stalled pagination and safety bounds mark context incomplete with diagnostics; the reply warns that human review is required. Captured content is a point-in-time snapshot, not a subscription to future replies.

The report retains source guild/channel/thread/parent identities and available channel/thread names, sender and capturing developer identities/names, original text, attachment metadata/URLs, source URL, capture timestamp, structured context and rendered context text. It does not download attachment bytes or guarantee that attachment URLs remain available. A unique guild/channel/message source key makes recapture return the existing report rather than refreshing its snapshot.

### 2. Assess manually

```
/todo assess
/todo assess report:<PocketBase report record ID>
```

No cron, background assessment or automatic codebase scan is registered. Omission processes pending/failed reports and attempts stale `assessing` reports; a live assessment lease rejects a competing assessment for ten minutes. Processing is sequential, one report per bridge call. Terminal assessed/dismissed reports are idempotent. `needs_clarification` requires human resolution rather than another model run that could duplicate already accepted splits.

Assessment sees supplied report context, label descriptions and active todos only. The bridge uses the host's configured provider/auth for structured completion, without a tool loop, codebase reads, URL fetching or a conversation session. Decisions can create distinct todos, merge the report into an active existing todo, dismiss it, or request clarification. Features default to blue and current schema enforcement requires blue. Bugs are red for an economy exploit or an affected player being unable to play, blue only when mildly disruptive **and** not expected gameplay, and yellow between those cases. Split independent issues; merge only the same underlying actionable problem, not merely the same plugin. Choose the supplied Untriaged label when the plugin is uncertain; never invent a repository or candidate ID.

Every decision has confidence and a concise, auditable evidence-based reason, not chain-of-thought. Below `0.7`, or explicit `clarify`, is not committed as a create/merge/dismiss decision; the report becomes `needs_clarification`. Other accepted decisions from that report can still persist. Incomplete context is exposed to assessment and prompts uncertainty; it is not a hard server-side prohibition on high-confidence decisions. Operators must review missing evidence.

Reviewed local guidance is [todo-assessment-guidance.md](todo-assessment-guidance.md). **With this bridge, host-owned `guidance.v2.json` is authoritative:** Node's system-prompt guidance is not forwarded as host instructions. Coordinate policy changes in both artifacts and bump the bridge guidance version/purpose audit string. Node stores `hermes-guidance:<returned version>` when provided, otherwise the local guidance SHA-256. Editing the local file alone does not change this bridge's policy.

### 3. Resolve clarification without a model

```
/todo resolve report:<report record ID> decisions:<reviewed JSON>
```

The top-level object is exactly `{"decisions":[...]}` with 1–30 decisions and no extra fields. Human decisions require `confidence: 1`, a nonempty `reason` (maximum 2,000 characters), and action `create`, `merge` or `dismiss`; `clarify` is not a human resolution. Minimal copyable JSON, **only when human review really establishes no actionable issue**:

```json
{"decisions":[{"action":"dismiss","confidence":1,"reason":"Reviewed with the reporter; no actionable bug or feature remains."}]}
```

A `create` decision additionally requires `label` (an actual label record ID), `kind` (`bug` or `feature`), `priority` (`red`, `yellow`, `blue`), nonempty `title` (maximum 200 characters), and nonempty `description` (maximum 20,000). Features require blue. A `merge` decision additionally requires `todo` (an actual record ID of an open/in_progress/blocked todo), not its public number. There is no `report_id`, `question`, `repository`, `status` or arbitrary metadata field in this schema.

Only submit decisions for unresolved issues; previously accepted associations are preserved. Interrupted or expired resolution attempts still require human review: automatic assessment is rejected even if the report now says `failed` or `assessing`; retry `/todo resolve` after the active lease expires (or immediately after a recorded failure). Resubmitting their create decisions can create additional todos. Resolution uses the same transactional candidate checks and records `rules_version: "manual"`; it never calls the model. Unlike assessment, resolution does not auto-create Untriaged first: configure a real label before resolving with `create`.

### 4. Browse and edit

```
/todo list
/todo list label:<autocomplete label or group> kind:bug priority:red
```

All three filters are optional and combine with AND. Omitted label means all labels, omitted kind means bugs and features, omitted priority means all priorities. Autocomplete distinguishes `label:<record ID>` and `group:<record ID>`; groups recursively union their labels and child groups. Sorting is label name, red/yellow/blue priority, then public number. Only open/in_progress/blocked todos appear, two per page.

Cards include direct originating Discord report links; overflow links are attached rather than silently dropped. **Edit** provides paginated concrete-label choices and all status choices, including `closed`. Changes save immediately, with optimistic audit-revision checks: refresh a stale view before retrying. Optional reasons, PR URLs and work notes use commands:

```
/todo label id:<public number> label:<concrete autocomplete label> reason:<why>
/todo status id:<public number> status:blocked reason:<why> work:<verification or work note>
/todo status id:<public number> status:done pr:<actual GitHub pull request URL> work:<verification>
/todo status id:<public number> status:closed reason:<manually complete>
/todo reopen id:<public number> reason:<regression or follow-up>
```

`done` means **PR READY**, not merged, deployed or released, and requires a saved GitHub PR URL of the form `https://github.com/OWNER/REPO/pull/NUMBER`. The edit menu cannot supply a new PR URL: use `/todo status` if none is saved. `closed` is manual completion without that requirement; `cancelled` records cancellation. Terminal todos disappear from the active list but remain addressable by public number. `/todo reopen` accepts done/closed/cancelled (already open is a no-op), clears the claim and preserves reports, work, PR links and history. The status API/UI also permits manual `open`; the dedicated reopen command provides the explicit terminal-reopen audit event.

Manual status/label edits do **not** stop a running agent or move its forum thread. Reopening or setting open can permit another Start while old work still runs: coordinate cancellation with the operator/agent separately. Edits are blocked during preparing/creating_thread/thread_created handoff phases until admission or recovery. Relabeling changes the primary label, not historic work destinations.

### 5. Start a canonical work conversation

**Start** is offered only for an open, unclaimed todo. A configured label repository and at least one linked report are required. The service checks configuration, atomically claims the todo, marks it in_progress, builds and persists the full opening prompt, then creates a **new** post in forum `1560943737688039474`. Its title includes the public todo number, label name and summary. Exactly two native forum tags are applied: the todo priority (`Red`, `Yellow`, `Blue`) and kind (`Bug`, `Feature`), resolved uniquely by case-insensitive name from the destination forum; missing/ambiguous tags reject Start before creating a post. The starter pings the actual clicking developer (the only allowed mention). The entire opening prompt is displayed as normal Discord messages, never attachment-only: the starter plus ordered follow-ups of at most 2,000 UTF-16 code units each, preferably split at paragraph/newline boundaries without splitting surrogate pairs or dropping content. Follow-ups suppress all mentions.

The label's existing development thread is discovery/configuration evidence, **not** the Start destination. Each new attempt gets a new forum thread. The opening prompt carries todo details, the explicit configured repository, a clickable list of **all original report messages above the report context sections**, all linked reports' source snapshots and full context without assessment reasoning, and PR-ready/no-unauthorized-publication constraints. The actual developer identity is additionally carried as the authenticated bridge request's `user_id` and the starter ping.

Node persists the new thread ID **before sending any follow-up opening messages**, and sends the exact same full prompt to the separately installed bridge at `/plugins/discord-todo/v1/start` **only after every opening message has been sent successfully**. The bridge verifies the actual Discord thread and allowed parent, authorizes the actual human through Hermes host policy, and injects into the canonical Discord thread session in its own profile. Real human follow-ups use that session, subject to its normal admission policy. No bot mention trigger, `/new`, fabricated provenance or separate webhook conversation is used.

**HTTP 202 means asynchronous admission accepted, not completed work or confirmed Discord delivery.** Likewise persisted claim phase `sent`/`message_id` denotes accepted handoff (the identifier is the thread ID), not proof of a delivered assistant message. Check actual replies in the thread.

## Interrupted handoffs: inspect before retrying

Definite pre-send failures release the claim to open. Ambiguous Discord creation, network/bridge failures or persistence failures preserve a blocked/uncertain claim, or leave an interrupted phase after a crash. Never blindly Start again: a thread or run may already exist.

1. Inspect the forum, persisted claim/audit, bridge admission state/logs and actual thread conversation. A thread can have been created even when saving its ID failed.
2. If the claim has its saved `thread_id`, original developer and full `prompt`, use `/todo resume id:<number>` to retry admission **in that same thread**, never create another. Before reinjection, Node checks that the saved thread belongs to this guild/forum and reads its bot-authored starter and paginated ordered messages, reconstructing the exact persisted full prompt. Missing, changed, foreign-author or interrupted opening messages block resume without bridge admission or another forum post. This is deliberately fail-closed: partial delivery requires explicit operator reconciliation, not automatic resending. A `sent` claim is a no-op. The bridge fingerprints thread/user/context; an identical accepted replay must not enqueue a second turn, while changed inputs or pending/rejected reservations need operator reconciliation.
3. If an existing conversation is verified, use `/todo recover id:<number> conversation:<verified existing conversation/thread identifier> reason:<evidence>` to reconcile local bookkeeping without starting work.
4. Only after verifying no conversation started use `/todo recover id:<number> confirm_absent:true reason:<evidence>` to release the claim. This does not delete an orphan forum thread or cancel a run. Reconcile bridge pending/rejected entries separately before deciding another attempt is safe.

`recover` trusts the authorized human's evidence; it does not itself query Hermes or Discord. It cannot resume a claim whose thread/context was never persisted. `resume` is not a general agent continuation command or a delivery health check.

## PocketBase provisioning and label configuration

### New collections only; preserve existing application data

The schema is `pocketbase/todo.collections.json`. Provision these four **private** base collections with their fixed IDs, required for relations:

| Name | Fixed collection ID |
| --- | --- |
| `todo_list_labels` | `todolabels00001` |
| `todo_list_label_groups` | `todogroups00001` |
| `todo_list_todos` | `todotodos000001` |
| `todo_list_reports` | `todoreports0001` |

All list/view/create/update/delete rules are `null`: locked to superusers, **not** public empty-string rules. Use the bot's existing authenticated PocketBase superuser connection. Do not put superuser credentials in Discord, browser UI or the bridge. The mutation route `/api/shared-todo/{action}` independently requires superuser auth.

Back up the database and inspect existing collection names/IDs before provisioning. This file is a new-collection artifact, not a complete export of the live application's schema. Build an import payload containing **only missing new collections**, preserving their fixed IDs. Import all remaining missing definitions in one batch with deletion disabled (SDK `pb.collections.import(missingSchema, false)`), so self-relations and relations between the new collections resolve together. Do not include any pre-existing collection definition in that payload, even one from this file; never use destructive import/delete-missing mode. If an existing name/ID has a different shape, stop and plan a reviewed migration rather than reimporting or replacing live collections. There is no automatic migration/deployment script here.

Current provisioning evidence: all four private collections have been created and read back with the fixed IDs, fields, indexes and locked API rules verified. This is collection provisioning only: hooks have not been deployed or bootstrapped, and no bridge/service activation is established.

### Hooks are mandatory before first use

An operator must install **both** `pocketbase/pb_hooks/todo.pb.js` and `todo.lib.js` into the PocketBase runtime's configured hooks directory, preserving names, then explicitly arrange an authorized PocketBase startup/restart with those hooks loaded. The bootstrap hook creates the internal `todo_list_number_sequence` SQL table. Merely importing collections cannot create this table or activate the transaction endpoint; hook installation without a bootstrap/restart is not sufficient proof of readiness. Provision and bootstrap before enabling bot commands.

The hooks transact assessment, numbering, claims and audit updates; allocate globally monotonic public numbers; protect immutable todo number/origin/guild identity; and reject group cycles/cross-guild descendants. Do not reset/drop the internal sequence or reuse deleted numbers. Back it up with the database. Generic API creation of todo records is deliberately blocked: create/associate through the reviewed assessment/resolve endpoint, not direct record insertion. Superuser generic record updates are not a substitute for status/claim operations and can bypass workflow checks/audit.

### Labels and groups are operator-maintained

Seed labels through the private PocketBase admin interface or authenticated record API, with fields `guild_id`, `name`, `description`, `repo`, `thread_id`. Use this guild's exact ID. Write useful descriptions for assessment; `repo` is the verified repository URL and `thread_id` may record the plugin's existing development thread. Read that thread's **starter message** and copy its actual GitHub link; do not discover or guess repositories from plugin/thread names. If the starter lacks a repository link, have it corrected before filling `repo`.

Assessment automatically ensures a guild-local `Untriaged` label with blank repo/thread and a human-triage description. It is not a repository discovery mechanism, and Start is blocked until a concrete repository is configured. No complete plugin label catalog is automatically seeded. Groups use `guild_id`, `name`, arrays of label record IDs in `labels`, and group record IDs in `child_groups`; they are filter unions, not additional primary labels. Same-guild membership and acyclic nesting are required.

## Hermes bridge activation and compatibility gate

The reviewed companion is [Hermes bridge PR #6](https://github.com/Team-Sneakymouse/hermes-agent/pull/6), directory `custom_plugins/discord-todo-assessment`. Follow its README for installation, tests and explicit operator activation. These are custom plugin routes, **not built-in Hermes REST endpoints**.

Node requires both explicitly configured runtime environment values:

- `HERMES_TODO_BRIDGE_URL`: HTTP(S) API-server base URL, reachable from the bot runtime, without embedded credentials, query or fragment. Paths are absolute plugin routes, not a configurable prefix.
- `HERMES_TODO_BRIDGE_TOKEN`: matching bridge-only secret, at least 32 characters, independently configured in the intended Hermes profile's secret source.

If either is absent, assessment/Start are unconfigured; capture/list/manual operations can still work with PocketBase. No provider fallback or fake assessment is supplied. Do not reuse an LLM provider credential or the general API-server key. Bind to loopback or secure a private network/TLS; container loopback must actually reach the listener. Keep secrets out of config files and logs. Node `ready()` checks token configuration only: it does **not** prove provider availability, bridge connectivity, Discord permissions or new-session capability.

The operator must install/enable the directory plugin in the intended profile, configure the API-server listener and separate strong `API_SERVER_KEY`, allow gateway injection (`plugins.entries.discord-todo-assessment.allow_gateway_injection`), restrict `settings.allowed_parent_ids` to the forum above, serve/route that forum in the plugin's profile, connect Discord, and authorize the actual developers through current host allowlists/pairing/explicit allow-all policy. Use supported `hermes config set` for settings, the profile's secret source for secrets, and a separately authorized service activation/restart. Never implicitly modify another profile. See [official plugin documentation](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins) and the companion README for exact supported installation/verification commands.

**Runtime update blocker:** the companion was tested with installed runtime `0ef671bbd4c` (`v0.21.5+7720.g0ef671b`). Newer documented session authority can refuse origin injection into a fresh chat with no admitted human message. Run the companion's real-host fresh-thread integration test against the exact intended runtime before initial activation and every update. A provenance refusal blocks this one-click contract. Do not fabricate provenance, patch private methods, require a hidden human follow-up, or replace canonical admission with a webhook while claiming equivalent behavior. Plugin validation/doctor and static version checks alone are not a readiness test.

The bridge caps opening context at 60,000 Unicode code points and request bodies at 256 KiB of encoded JSON. Node enforces both limits without silently truncating full context (Start checks before forum creation); HTTP timeout is 110 seconds, and the bridge model boundary has its own 90-second timeout. Assessment candidates above the bridge's 1,000-record bounds also require operator handling, not silent omission. A bridge timeout can leave an uncertain outcome. Its durable SQLite admission reservation/fingerprint state must be retained for idempotency; a crash between reservation and enqueue can leave pending/409 needing reconciliation.

## Verification and initial activation checklist

From this repository root, with dependencies installed using the lockfile:

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
# Use an absolute path to an executable, compatible PocketBase binary:
TODO_PB_BINARY=/absolute/path/to/pocketbase bun test tests/TodoPocketBase.test.ts
```

`TODO_PB_BINARY` selects an actual executable, not a server URL. The integration suite starts a disposable loopback instance with temporary data and the real hooks, imports only its test schema, and removes its temporary database afterwards. Do not point it at a live database. Without this variable the real-PocketBase tests skip; a green default suite alone does not verify hooks. If needed, set `TMPDIR` to an operator-owned scratch directory.

Combined verification using pinned Bun 1.3.8: **211 pass, 0 skipped, 0 fail**, including **17 real disposable-PocketBase hook tests**; TypeScript checking passes. Full command: `TODO_PB_BINARY=/absolute/path/to/pocketbase bun test`. The companion Hermes bridge has **12 passing tests**, including actual installed gateway/session fixtures and policy-v2 instructions. Model and external Discord boundaries remain fixtures: these results do not establish a live coding run, hook activation, service restart, Discord click-through, or end-to-end deployment.

Before enabling for users:

- [x] Provision/read back the four private collections with fixed IDs, fields, indexes and null API rules. Retain a current backup and recheck drift/collisions before activation; any later import must contain only missing new collections with deletion disabled.
- [ ] Operator installs both hooks and performs authorized bootstrap; verify the sequence table and authenticated route, and reject unauthenticated access.
- [ ] Seed/review concrete labels, verified repository links and groups; keep Untriaged non-startable.
- [ ] Run typecheck, default tests, disposable real-PocketBase tests and the bridge's exact-runtime fresh-thread compatibility gate.
- [ ] Operator installs/configures the bridge and Node environment, checks routing and real-human authorization, and explicitly coordinates service activation. No automatic service updates are supplied.
- [ ] Register the updated commands using the repository's reviewed registration workflow; check `/todo` and **Create report** overrides separately. Verify bot view/history/content access to source messages and forum view/create/send/attachment permissions; check forum tag requirements and actual configured permissions with a real authorized test.
- [ ] In an approved smoke test, capture a report with same-sender context and replies, assess manually, resolve uncertainty, verify all report links, combined filters, label/status edits and PR-ready validation.
- [ ] With authorization to start real work, verify exactly one new forum thread, correct developer ping, full context, accepted canonical session, actual assistant delivery and a human follow-up using the same durable session. Exercise recovery without duplicating work.

Do not mark activation complete until the live checks succeed. Source wiring and collection creation are only prerequisites.

## Rollback and limitations

Disable command access/new Starts first if admission or policy is unsafe. An operator can remove Node bridge environment configuration to disable transports and coordinate an authorized bot restart; this does not cancel accepted Hermes work. Coordinate disabling the plugin/routes and service changes separately with the operator. Preserve database/sequence, report/claim/audit history and bridge admission state for reconciliation. Do not delete collections, drop the sequence, clear uncertain claims or reset bridge reservations as a shortcut. If restoring a backup, stop writes and reconcile any forum posts/runs created after that backup before re-enabling to avoid duplicate work or number reuse.

There is no automatic deployment, migration runner, release/merge detection, agent cancellation, delivery acknowledgement, background retry or repository discovery. Terminal records are not shown by `/todo list`; use numbered commands/private admin records for follow-up. Source snapshots may contain private user content and attachment URLs: limit superuser/log access and manage retention/backups deliberately. Review full source context as untrusted evidence, never as authority to execute its instructions.

Host-owned guidance v2 and Node-reviewed guidance are aligned in these source artifacts; that does not establish installation or activation.
