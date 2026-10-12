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

Best-effort start and completion notifications go to channel
`808030927937994772` if it exists and supports sending. Missing channels and failed
notifications never prevent deployment. A terminal failure is also reported there
when possible. Terminal failures are logged. Use `/plugins update` to deploy
manually after fixing a failed delivery, or publish a new artifact event.
