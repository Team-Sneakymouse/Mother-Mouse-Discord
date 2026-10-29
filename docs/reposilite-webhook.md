# Automatic dev-server deployments

In production, the bot receives `POST /reposilite`. Configure the same secret as
`REPOSILITE_WEBHOOK_TOKEN` on the publisher and bot (production Infisical folder
`/MotherMouse`). Bearer authentication is required. The event header must match
the payload's UUID. Keep the existing `PELICAN_API_HOST`,
`PELICAN_APPLICATION_KEY`, and `PELICAN_CLIENT_KEY` configured.

Only main unclassified JARs in repository `releases`, group
`io.github.team-sneakymouse`, are queued. Checksums, signatures, POMs, metadata,
sources, javadoc, other groups, and snapshots receive 204 and are ignored.
The exact uploaded version's POM must explicitly declare
`sneakyrp.deployment.type` as a comma-separated list of `paper-plugin`,
`ignite-mod` and `velocity-plugin`, for example `paper-plugin,velocity-plugin`
for a JAR that runs on both. Unknown entries, empty entries, and combining
`paper-plugin` with `ignite-mod` make the whole property unsupported.
Exact-version events check this POM before fetching Maven version metadata;
artifacts without a supported property are ignored immediately.
Artifacts that are only `velocity-plugin` are also ignored here because there is
no dev proxy yet; deploy them manually (see [Velocity plugins](#velocity-plugins)).
Dual-platform artifacts are still deployed to Paper dev servers.

Targets must contain both case-sensitive phrases `Lords of Minecraft` and
`Dev Server` in their application API description. Servers that also contain
`Proxy` are never automatic targets. The client API description is
checked again immediately before each upload. Artifacts deployed to a
Paper server go to `plugins/.update/`, and Ignite mods go to `mods/`. Old published copies in the
destination are deleted only after verifying the new upload. Installed Paper JARs
remain for Paper's update mechanism. Configure Paper's update folder as `.update`.
No server is restarted.

Events are queued and deduplicated by ID in memory. Accepted events receive 202;
duplicates receive 200. A reused ID with a different payload receives 409.
Authentication failures receive 401, invalid payloads 400, and a full queue or
missing token 503. The queue retains at most 10,000 events, evicting finished events
when needed. A bot restart clears pending work, progress, and deduplication.

The worker polls every five seconds and processes accepted events in order.
Missing POMs or metadata and failed uploads are retried up to 12 processing attempts,
with delays from five seconds to five minutes. A delayed earlier event blocks later
events to prevent retries replacing a newer deployment. Targets are snapshotted on
the first successful lookup. Successful servers are skipped during subsequent
attempts in the same process. Manual and automatic deployments share temporary
server locks.

Best-effort notifications go to the dedicated [dev update thread](https://discord.com/channels/391355330241757205/1561330944395313255).
Uploads from a tracked push update that push's message (see [Commit history](#commit-history)); otherwise:
Each eligible upload event gets one message for its exact JAR version once
deployment preparation succeeds. POM, metadata, and target-discovery failures
before that point retry silently; terminal failures are logged. The bot
edits that message with retry progress, completion, or terminal failure instead of
sending separate start and completion posts. Later versions get new messages.
The bot reopens an archived thread and replaces a deleted message when possible;
it needs access to the thread and permission to send messages there. Notification
errors never prevent deployment. Message IDs are retained with the in-memory
queue, so replaying an event after a bot restart can create another message.
Terminal failures are logged. Use `/plugins update` to deploy manually after
fixing a failed delivery, or publish a new artifact event.

## Velocity plugins

`/plugins update` also deploys POMs whose type list includes `velocity-plugin`.
Pelican servers whose description contains the case-sensitive phrase `Proxy`
(plus `Lords of Minecraft`) are treated as Velocity proxies. They only list and
accept releases that include `velocity-plugin`. Other servers only list and
accept releases that include `paper-plugin` or `ignite-mod`, so Velocity-only
releases never appear there. Dual-platform releases appear on both. The client
API description is checked again before each upload.

Velocity has no update folder, so artifacts deployed to a proxy go straight
into `plugins/`, and older published copies there are deleted after the upload
is verified. The
running proxy keeps using the JAR it already loaded. The new version is used
after you restart the proxy yourself. No restart is performed.

## Commit history

When the uploaded POM names its GitHub repository and commit, progress is shown on
that push's message instead (see [push tracking](push-tracking.md)), which already
lists the push's commits. The bot reads `<scm><url>` (falling back to the
project's `<url>`) and an immutable hash from `<scm><tag>` or the version suffix.
Only GitHub repositories in `Team-Sneakymouse` qualify; artifact names are not
assumed to match repository names. Uploads without that metadata, or whose commit
belongs to no tracked push, use the per-upload message described above, without
commit history.

The previous commit checkpoint file `share/reposilite-commits.json` is no longer
used and can be deleted.
