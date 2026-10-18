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
`sneakyrp.deployment.type` as `paper-plugin` or `ignite-mod`.
Exact-version events check this POM before fetching Maven version metadata;
artifacts without a supported property are ignored immediately.

Targets must contain both case-sensitive phrases `Lords of Minecraft` and
`Dev Server` in their application API description. The client API description is
checked again immediately before each upload. Paper updates go to
`plugins/.update/`, Ignite mods go to `mods/`. Old published copies in the
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

## Commit messages

Published POMs such as SneakyMail, SneakyMisc, and SneakyJobBoard already provide
GitHub repository URLs, and their date-based version strings end in the build's
commit hash. The bot reads `<scm><url>` (falling back to the project's `<url>`)
and an immutable hash from `<scm><tag>` or the version suffix. Only GitHub
repositories in `Team-Sneakymouse` qualify; artifact names are not assumed to match
repository names.

The first tracked update shows the release commit's subject. Subsequent updates
show subjects of commits since the last successful automatic upload of that
artifact to all its snapshotted dev-server targets. These are uploaded versions,
not confirmation of which version is running. Partial failures, ignored artifacts,
and events with no matching servers do not advance the checkpoint. Manual
deployments do not advance it either. Repository changes start a fresh comparison.

Checkpoints are atomically saved in `share/reposilite-commits.json`. Preserve
`/app/share` using a persistent Docker volume or bind mount to retain comparisons
across container replacements. The queue itself remains in memory. An upload
without source metadata clears that artifact's checkpoint after success so the
next update does not compare against stale history.

The [GitHub commit API](https://docs.github.com/en/rest/commits/commits#get-a-commit)
supports fetching a single release commit, and the
[compare API](https://docs.github.com/en/rest/commits/commits#compare-two-commits)
provides the range between two release hashes. The bot fetches the first 100
commits, displays subjects that fit in the message, and links to the complete
comparison with a count of omitted commits. Commit bodies are not displayed.
Unavailable or divergent comparisons fall back to the single release commit.
Missing metadata, API errors, and checkpoint failures never retry successful
uploads; the message shows a fallback when commit messages cannot be retrieved.

The existing `GITHUB_TOKEN` is used when configured. Private repositories need
repository **Contents: read** access; public repositories can be queried without
a token, subject to GitHub's lower unauthenticated rate limit. Configure the token
in the same runtime secret folder as the bot's other credentials.
