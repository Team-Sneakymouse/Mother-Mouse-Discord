import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { escapeMarkdown } from "discord.js";
import { z } from "zod";
import type { Artifact, ArtifactSource } from "./PluginDeployment.js";

const sourceSchema = z.object({ repository: z.string().regex(/^Team-Sneakymouse\/[A-Za-z0-9_.-]+$/i), commit: z.string().regex(/^[a-f0-9]{7,40}$/i) });
const commitSchema = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/i), commit: z.object({ message: z.string() }) });

function subject(message: string): string {
	return escapeMarkdown(message.split(/\r?\n/)[0].slice(0, 180).replace(/@/g, "@\u200b").replace(/</g, "‹").replace(/>/g, "›"));
}

export interface DeploymentChangelog {
	describe(artifact: Artifact): Promise<string>;
	completed(artifact: Artifact): Promise<void>;
}

// Checkpoints describe successful uploads to all snapshotted targets, not server restarts.
export class PluginChangelog implements DeploymentChangelog {
	constructor(
		private file = "share/reposilite-commits.json",
		private token = process.env.GITHUB_TOKEN,
		private request: typeof fetch = fetch,
	) {}

	private async checkpoints(): Promise<Record<string, ArtifactSource>> {
		try {
			return z.record(z.string(), sourceSchema).parse(JSON.parse(await readFile(this.file, "utf8")));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
			throw error;
		}
	}

	private async get(path: string): Promise<unknown> {
		const response = await this.request(`https://api.github.com${path}`, {
			redirect: "error",
			signal: AbortSignal.timeout(15_000),
			headers: {
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
			},
		});
		if (!response.ok) throw new Error(`GitHub request failed (HTTP ${response.status})`);
		return response.json();
	}

	async describe(artifact: Artifact): Promise<string> {
		if (!artifact.source) return "Commit history unavailable: this release has no GitHub repository and commit metadata.";
		const { repository, commit } = artifact.source;
		const root = `https://github.com/${repository}`;
		const currentLink = `${root}/commit/${commit}`;
		try {
			const previous = (await this.checkpoints())[artifact.id];
			if (previous && previous.repository.toLowerCase() === repository.toLowerCase() && previous.commit !== commit) {
				const range = `${previous.commit}...${commit}`;
				try {
					// Only the first page can fit in Discord; the compare link exposes the entire range.
					const comparison = z
						.object({
							status: z.enum(["ahead", "behind", "diverged", "identical"]),
							total_commits: z.number().int().nonnegative(),
							commits: z.array(commitSchema),
						})
						.parse(await this.get(`/repos/${repository}/compare/${range}?per_page=100&page=1`));
					if (comparison.status === "ahead" || comparison.status === "identical") {
						const lines: string[] = [];
						const link = `[View all changes](${root}/compare/${range})`;
						let size = 0;
						for (const item of comparison.commits) {
							const line = `- [${item.sha.slice(0, 7)}](${root}/commit/${item.sha}) ${subject(item.commit.message)}`;
							if (size + line.length + link.length > 1000) break;
							lines.push(line);
							size += line.length;
						}
						if (lines.length < comparison.total_commits) lines.push(`${comparison.total_commits - lines.length} more commit(s) in the comparison.`);
						lines.push(link);
						return lines.join("\n");
					}
				} catch {
					// Missing history, force pushes and API failures can still allow a single-commit lookup.
				}
				const current = commitSchema.parse(await this.get(`/repos/${repository}/commits/${commit}`));
				return `**Release commit** (comparison unavailable)\n- [${commit}](${currentLink}) ${subject(current.commit.message)}`;
			}
			const current = commitSchema.parse(await this.get(`/repos/${repository}/commits/${commit}`));
			return `**Release commit**${previous ? "" : " (first tracked update)"}\n- [${commit}](${currentLink}) ${subject(current.commit.message)}`;
		} catch {
			return `Commit messages unavailable. [View release commit](${currentLink})`;
		}
	}

	async completed(artifact: Artifact): Promise<void> {
		const checkpoints = await this.checkpoints();
		// Do not compare a later release against stale history after an untraceable upload.
		if (artifact.source) checkpoints[artifact.id] = artifact.source;
		else delete checkpoints[artifact.id];
		await mkdir(dirname(this.file), { recursive: true });
		await writeFile(`${this.file}.tmp`, JSON.stringify(checkpoints), "utf8");
		await rename(`${this.file}.tmp`, this.file);
	}
}
