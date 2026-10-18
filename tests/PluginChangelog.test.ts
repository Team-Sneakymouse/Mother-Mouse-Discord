import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PluginChangelog } from "../src/utils/PluginChangelog.ts";
import { type Artifact, artifactSource } from "../src/utils/PluginDeployment.ts";

const previous = "a".repeat(40);
const current = "b".repeat(40);
const artifact = {
	id: "Example",
	version: `2026.10.18-${current.slice(0, 12)}`,
	source: { repository: "Team-Sneakymouse/Example", commit: current.slice(0, 12) },
} as Artifact;
const commit = (sha: string, message: string) => ({ sha, commit: { message } });

test("release source uses the POM's repository and immutable SCM tag or version suffix", () => {
	const pom = (url: string, tag = "") => `<project><scm><url>${url}</url><tag>${tag}</tag></scm></project>`;
	assert.deepEqual(artifactSource(pom("https://github.com/Team-Sneakymouse/Example.git"), artifact.version), artifact.source);
	assert.deepEqual(artifactSource(pom("https://github.com/Team-Sneakymouse/Example/", previous), "1.0"), { ...artifact.source, commit: previous });
	assert.deepEqual(artifactSource(pom("https://github.com/Team-Sneakymouse/Example", "HEAD"), artifact.version), artifact.source);
	for (const url of [
		"https://evil.example/Team-Sneakymouse/Example",
		"https://github.com.evil.example/Team-Sneakymouse/Example",
		"https://github.com/other/Example",
	])
		assert.equal(artifactSource(pom(url), artifact.version), undefined);
	assert.equal(artifactSource(pom("https://github.com/Team-Sneakymouse/Example"), "1.0"), undefined);
});

test("first tracked update fetches its exact commit; saved checkpoints survive new instances", async () => {
	const directory = await mkdtemp(join(tmpdir(), "plugin-changelog-"));
	const file = join(directory, "commits.json");
	const paths: string[] = [];
	const request: typeof fetch = async (input, init) => {
		paths.push(String(input));
		assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
		assert.equal(init?.redirect, "error");
		return Response.json(commit(current, "Fix **inventory** @everyone\n\nDetailed body"));
	};
	try {
		const changelog = new PluginChangelog(file, "test-token", request);
		const text = await changelog.describe(artifact);
		assert.match(text, /first tracked update/);
		assert.ok(text.includes("Fix \\*\\*inventory\\*\\* @\u200beveryone"));
		assert.ok(!text.includes("Detailed body"));
		assert.equal(paths[0], `https://api.github.com/repos/Team-Sneakymouse/Example/commits/${artifact.source!.commit}`);
		await changelog.completed(artifact);
		assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { Example: artifact.source });
		const next = { ...artifact, source: { ...artifact.source!, commit: "c".repeat(12) } };
		const restarted = new PluginChangelog(file, "test-token", async (input) => {
			assert.ok(String(input).includes(`/compare/${artifact.source!.commit}...${next.source.commit}?`));
			return Response.json({ status: "ahead", total_commits: 2, commits: [commit(current, "First change"), commit("c".repeat(40), "Second change")] });
		});
		const range = await restarted.describe(next);
		assert.match(range, /since last successful update \(2\)/);
		assert.match(range, /First change/);
		assert.match(range, /Second change/);
		assert.match(range, /View all changes/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("long commit ranges fit one message and link to every omitted commit", async () => {
	const directory = await mkdtemp(join(tmpdir(), "plugin-changelog-"));
	try {
		const changelog = new PluginChangelog(join(directory, "commits.json"), "", async () =>
			Response.json({
				status: "ahead",
				total_commits: 350,
				commits: Array.from({ length: 100 }, () => commit(current, "Long commit subject ".repeat(100))),
			}),
		);
		await changelog.completed({ ...artifact, source: { ...artifact.source!, commit: previous } });
		const text = await changelog.describe(artifact);
		assert.ok(text.length <= 1100);
		assert.match(text, /\(350\)/);
		assert.match(text, /more commit\(s\)/);
		assert.ok(text.endsWith(`${previous}...${artifact.source!.commit})`));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("unavailable or divergent comparisons fall back to the exact release commit", async () => {
	const directory = await mkdtemp(join(tmpdir(), "plugin-changelog-"));
	try {
		for (const comparison of [new Response(null, { status: 404 }), Response.json({ status: "diverged", total_commits: 3, commits: [] })]) {
			const changelog = new PluginChangelog(join(directory, "commits.json"), "", async (input) =>
				String(input).includes("/compare/") ? comparison : Response.json(commit(current, "Release subject")),
			);
			await changelog.completed({ ...artifact, source: { ...artifact.source!, commit: previous } });
			const text = await changelog.describe(artifact);
			assert.match(text, /comparison unavailable/);
			assert.match(text, /Release subject/);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("missing metadata and GitHub errors return readable fallbacks", async () => {
	const directory = await mkdtemp(join(tmpdir(), "plugin-changelog-"));
	try {
		const changelog = new PluginChangelog(join(directory, "commits.json"), "", async () => new Response(null, { status: 403 }));
		assert.match(await changelog.describe(artifact), /Commit messages unavailable.*View release commit/);
		assert.match(await changelog.describe({ ...artifact, source: undefined }), /no GitHub repository and commit metadata/);
		await changelog.completed(artifact);
		await changelog.completed({ ...artifact, source: undefined });
		assert.deepEqual(JSON.parse(await readFile(join(directory, "commits.json"), "utf8")), {});
		await writeFile(join(directory, "commits.json"), "corrupt");
		assert.match(await changelog.describe(artifact), /Commit messages unavailable/);
		await assert.rejects(changelog.completed(artifact));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
