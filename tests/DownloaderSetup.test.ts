import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("production installs a checksummed upstream yt-dlp with Python, Node >=22 and ffmpeg", () => {
	const dockerfile = readFileSync(new URL("Dockerfile", root), "utf8");
	assert.doesNotMatch(dockerfile, /apk add[^\n]*youtube-dl/);
	assert.match(dockerfile, /apk add --no-cache[^\n]*python3[^\n]*nodejs[^\n]*ffmpeg/);
	assert.match(dockerfile, /releases\/download\/2026\.08\.19\/yt-dlp/);
	assert.match(dockerfile, /1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6/);
	assert.match(dockerfile, /sha256sum -c/);
	assert.match(dockerfile, /node.*process\.versions\.node/);
	assert.match(dockerfile, /yt-dlp --ignore-config --version/);
});

test("development builds and uses the production Dockerfile instead of a separate downloader installation", () => {
	const { scripts } = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
	assert.match(scripts.dev, /^docker build -t mother-mouse-discord:dev \. && docker run/);
	assert.match(scripts.dev, /mother-mouse-discord:dev/);
	assert.doesNotMatch(scripts.dev, /apk add|oven\/bun/);
});
