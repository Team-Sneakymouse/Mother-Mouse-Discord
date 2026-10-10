# YouTube downloader

The bot uses **yt-dlp**, not Alpine's `youtube-dl` compatibility command. The
Dockerfile downloads the official **2026.08.19** zipimport executable and checks
its SHA-256. That release bundles its matching **yt-dlp-ejs 0.8.0** challenge
solver scripts. Python 3, ffmpeg/ffprobe, and Node.js are installed in the image;
the build rejects Node versions below 22. The bot explicitly enables Node with
`--js-runtimes node`. Bun runs the bot but is not its YouTube challenge runtime.

`bun run dev` builds and uses the same Dockerfile as production, with the existing
source mount, port and `db` network. `bun run start` / `bun run watch` outside
Docker require Python 3.10+, Node 22+, ffmpeg, and the same upstream yt-dlp
release on PATH. For a pip installation, use `yt-dlp[default]==2026.8.19` so the
matching EJS dependency is installed. Do not install bare yt-dlp without EJS.

References: [upstream EJS setup](https://github.com/yt-dlp/yt-dlp/wiki/EJS),
[release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19).

## Updating

Update the version URL and SHA-256 together in `Dockerfile` and the setup
regression test. Get the checksum from the upstream release's `SHA2-256SUMS`
or asset digest, verify the downloaded file, rebuild, and rerun the checks below.
Bundled EJS is updated with that executable. Do not enable on-demand remote
scripts or switch to an unpinned `latest` URL. Keep yt-dlp current: YouTube can
change before the release becomes 90 days old.

## Optional operator authentication

A current downloader and JS runtime do **not** guarantee YouTube will accept the
server's IP/session. If it still says “Sign in to confirm you're not a bot”, an
operator may explicitly provide **`YTDLP_COOKIES_FILE`**, pointing to an authorized
Netscape-format cookie file inside the running container. It is passed as one
`--cookies` argument. Without it, the bot downloads anonymously. User/global
yt-dlp config is ignored; no browser cookies are collected automatically.

Treat this file as an account credential: obtain it only with the account
owner's permission, keep it outside the repository/build context, restrict host
file permissions, and never post its contents or commit it. Do not bake it into
the image. Use a dedicated account where appropriate; cookies can expire and
YouTube restrictions may persist even with valid cookies.

Example options to add to the operator's existing `docker run` configuration:

```sh
--mount type=bind,src=/secure/operator/youtube-cookies.txt,dst=/run/secrets/youtube-cookies.txt \
-e YTDLP_COOKIES_FILE=/run/secrets/youtube-cookies.txt
```

Use a dedicated **writable** mounted copy: yt-dlp saves the cookie jar when it
exits, so a read-only cookie mount may fail. Apply appropriate permissions for
the container user. `bun run dev` does not forward host cookie settings; for
this optional authenticated setup, add these options to its Docker invocation.
The bot's `.env` may set the path, but mounting/permissions remain the operator's
responsibility. Authentication diagnostics stay in operator logs; bot-verification
errors shown to Discord use a short operator-action message.

## Verification before deployment

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
docker build -t mother-mouse-discord:verification .
docker run --rm --entrypoint yt-dlp mother-mouse-discord:verification \
  --ignore-config --js-runtimes node --verbose --simulate -- \
  'https://youtu.be/J2JPiQ2aEBc?si=BjCc9_q9_MEdy_8H'
```

Check verbose output for the pinned yt-dlp version, bundled EJS and `node-22`
or newer, not “no supported JavaScript runtime”. Then exercise the bot's download
channel or `/youtube-dl` in the operator's environment and verify an actual MP3
attachment. A simulation or subprocess fixture does not prove Discord upload
or production YouTube authentication.
