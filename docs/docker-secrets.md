# Docker runtime secrets

The image authenticates to Infisical on every container start and injects secrets
from `/MotherMouse` before launching the bot. This includes starts after Watchtower
replaces the container. Running processes do not refresh secrets automatically.

Configure the service in your deployment's Compose file:

```yaml
services:
  mother-mouse-discord:
    image: ${REGISTRY_HOST}/mother-mouse-discord
    restart: unless-stopped
    secrets:
      - infisical
    environment:
      INFISICAL_DOMAIN: https://${INFISICAL_HOST}
      INFISICAL_PROJECT_ID: your-project-id
      INFISICAL_ENVIRONMENT: prod
      PRODUCTION: "TRUE"
      HTTP_PORT: "80"
      YTDLP_COOKIES_FILE: /run/youtube-auth/cookies.txt
    # Keep your existing networks, volumes and labels.

secrets:
  infisical:
    file: ./infisical-creds.env
```

Set `REGISTRY_HOST` and `INFISICAL_HOST` in the shell running Compose to your
registry hostname and Infisical instance hostname, respectively.

Create `infisical-creds.env` on the Docker host, outside this repository:

```sh
INFISICAL_CLIENT_ID='your-machine-identity-client-id'
INFISICAL_CLIENT_SECRET='your-machine-identity-client-secret'
```

Use LF line endings and shell-compatible assignments: this trusted file is sourced
by `/bin/sh`. Restrict access to the host file. Compose mounts it at
`/run/secrets/infisical`; it does not parse its contents as environment variables.
Give the machine identity read-only access to the required production folder.
The CLI includes secret imports configured on `/MotherMouse`, but does not fetch
subfolders recursively.

Remove the application's `env_file: .env` entry. Keep Compose configuration keys
such as `PRODUCTION`, `HTTP_PORT`, and `YTDLP_COOKIES_FILE` out of the Infisical
folder to avoid overriding them.

Authentication and fetching must succeed before the application starts. Failures
exit the container so its restart policy can retry. Infisical must be reachable
from inside the container; `localhost` refers to the container itself.

The CLI release and its SHA-256 checksums are pinned in the Dockerfile for amd64
and arm64. Local commands such as `bun start`
continue to use the existing dotenv setup; only the image entrypoint uses Infisical.
