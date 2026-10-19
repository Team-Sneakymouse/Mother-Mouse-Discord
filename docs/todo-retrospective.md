# Assessment correction retrospective

## Developer workflow

- `/todo label`, `/todo kind` and `/todo priority` change classification through the same revision-checked PocketBase transaction. Each accepts an optional `reason`. Detail cards also expose label, kind, priority and status selectors; selectors save immediately without inventing a reason. A deliberate non-blue feature priority is a supported human override, not a change to automatic feature defaults.
- Invoke `/todo retrospective` manually. It claims/reuses an explicit frozen correction batch. Ordinary `/todo assess` remains tool-free.
- A new investigation gets a **fresh Meta-tagged forum conversation** in `1560943737688039474`, with a non-task title. Its opening evidence, report links and context are normal Discord messages, split without truncation. The full agent may inspect repositories read-only and ask questions there. Answer normally in that conversation; there is no hidden follow-up command.
- Invoke `/todo retrospective` again, or **Refresh**, to see progress. Questions leave the run investigating; neither dispatch nor a draft consumes correction coverage.
- When proposed, the ephemeral view attaches the **complete `.diff` and full proposal JSON (including summary)** and displays its full SHA-256. Review the attachment before **Approve complete diff**. Approval is bound to the invoking developer, RAWBTV guild, bot-authored message, run and full displayed hash. An outdated proposal is refused; Refresh and review again.
- Only approval activates domain rules/memory. Built-in severity/confidence rules are not editable through this workflow. Even an explicit no-change conclusion requires approval.

## Transport and persistence

Use the existing `HERMES_TODO_BRIDGE_URL` and `HERMES_TODO_BRIDGE_TOKEN`. This feature does not configure listeners, credentials, deployment or restarts. Missing configuration is an explicit error, not a simulated investigation.

PocketBase uses authenticated `POST /api/shared-todo/{action}`:

1. `retrospective-begin {guild_id,actor}` returns `{run,corrections,reports,labels}` or an empty batch. Evidence and exact correction IDs are frozen server-side. An existing active run is owner-bound.
2. `retrospective-stage {id,actor,dispatch_token}` reserves first forum creation using a fresh 32-hex token. A different token must be rejected atomically. A reserved run with no saved thread has an uncertain creation outcome: **never automatically create a replacement**.
3. `retrospective-stage {id,actor,thread_id}` saves the created thread **before** continuation messages or bridge dispatch. A subsequent stage freezes `baseline_version` and `baseline_hash` returned by Hermes. Thread and established baseline cannot change.
4. `retrospective-proposal {id,actor,proposal_hash,proposal}` binds a validated draft; this does not activate policy or cover corrections.
5. A genuine approval first calls bridge `prepare-approval` with the exact displayed full hash. Its SQLite transaction validates owner/hash/baseline and freezes that proposal as `approval_pending`, rejecting later drafts without activating policy. Only then sync the frozen proposal into PB (unless already applying), call `retrospective-approve-begin`, bridge `approve`, and `retrospective-complete` with the exact durable receipt. A replacement draft winning before prepare rejects the click without PB approval changes.

The bridge endpoints are separate from PocketBase:

- `POST /plugins/discord-todo/v1/retrospective/start`: `{run_id,thread_id,user_id,guild_id,corrections,context}`. Returns accepted identity and frozen baseline; dispatch is idempotent for the exact persisted batch/thread.
- `POST /plugins/discord-todo/v1/retrospective/status`: `{run_id,user_id}`. Proposed state contains `proposal`, `proposal_hash`, full `diff` and `thread_id`; applied state contains `proposal_hash`, `policy_version` and `policy_hash`.
- `POST /plugins/discord-todo/v1/retrospective/approve`: `{run_id,user_id,proposal_hash}`. Only the authenticated human-control path calls it. It checks the frozen baseline and returns an idempotent applied receipt.

Read-only transport preflight checks context code points, serialized bytes, forum type/guild and exactly one native Meta tag **before dispatch reservation**; actual start validates again. `retrospective-release-dispatch {id,actor,dispatch_token}` releases only the exact owner/token on an investigating run with no thread or baseline, and is used only for proven precreation failures (including Discord API 403). Network-ambiguous writes retain the reservation.

`POST /plugins/discord-todo/v1/retrospective/prepare-approval` accepts `{run_id,user_id,proposal_hash}` and returns the full frozen proposal/diff or exact applied receipt. `approval_pending` renders the same complete attachments and Approve retry. Refresh never activates pending policy; retry activation requires another genuine click. PB applying hashes are never replaced.

PocketBase computes the **actual opening context** and serialized start payload (including the duplicated corrections and a 20-digit thread placeholder) against 60000 Unicode code points / 200000 UTF-8 bytes **before saving any freeze**. Small batches retain full inline evidence. Oversized batches retain every selected correction ID (up to 50), but send explicit `evidence_ref` records instead of copying arbitrarily large snapshots. `opening_context` is returned by begin and used unchanged by the bot; bot preflight still runs before any dispatch reservation. Newer corrections remain queued until a later approved batch; dispatch/reference creation does not cover any correction.

Reference mode requires the full agent's existing authenticated **PocketBase read tool** for private `todo_list_manual_changes` records; no new credentials or Hermes configuration are installed here. Each reference names the immutable event collection/ID and SHA-256 of its complete sorted-key, compact JSON, UTF-8 with unescaped Unicode. Read the whole original event, including developer reason, original assessment/policy in `todo_snapshot`, and full `reports` source/context. Original report URLs can be constructed from each frozen report's guild/channel/message IDs. The projected report URL list may itself move behind these explicit references when necessary. Current report/catalog records are not substitutes for immutable evidence. If a tool response is bounded, retrieve fields separately; if complete retrieval is not possible, ask for evidence/retrieval support and **do not invent a lesson or claim complete evidence coverage**. A field larger than the read tool's own output budget needs operator/tool support; this repository does not introduce a chunked evidence endpoint.

Legacy oversized freezes are converted to references only while unstarted (investigating/failed, no dispatch token, thread, baseline, proposal or approval). The run ID, exact correction IDs, sequence boundary, original immutable events and pending coverage are preserved; the existing `error` field records a recovery marker. Thread-bound, ambiguous dispatch and proposed/applying runs are not rewritten. Ordinary assessment/start retain their contracts.

## Recovery and verification boundaries

- A thread saved without a baseline resumes **that same thread**. Before retrying admission, the bot verifies the full opening context is already present as normal bot messages. Partial display requires restoring the missing messages in the existing thread; it never creates a replacement or injects incomplete context.
- An uncertain creation with no saved thread requires operator reconciliation of the existing forum post and owner-bound staging of its exact thread ID. Do not clear reservations blindly.
- If approval times out, the bot queries bridge status and accepts only a matching durable receipt. If PocketBase completion fails after policy activation, Refresh retries completion from that receipt without another policy write. Failed/unanswered/unapproved batches remain pending.
- Tests exercise loopback HTTP JSON and recorded Discord transport fixtures; these are not live forum creation, live model work or deployment verification. Test with pinned Bun 1.3.8, disposable real PocketBase hooks, `npm run typecheck` and `git diff --check` before publication.
