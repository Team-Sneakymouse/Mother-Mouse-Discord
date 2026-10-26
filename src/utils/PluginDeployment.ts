import { XMLParser, XMLValidator } from "fast-xml-parser";

const MAVEN = "https://maven.sneakyrp.com";
const GROUP = "io/github/team-sneakymouse";
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, processEntities: false });
export type DeploymentType = "paper-plugin" | "ignite-mod" | "velocity-plugin";
const TYPES: DeploymentType[] = ["paper-plugin", "ignite-mod", "velocity-plugin"];
// Velocity proxies are identified by this case-sensitive phrase in their panel description.
export const PROXY_PHRASE = "Proxy";
export type ArtifactSource = { repository: string; commit: string };
export type Artifact = { id: string; version: string; types: DeploymentType[]; versions: string[]; url: string; filename: string; source?: ArtifactSource; lastUpdated?: string };
export type Server = { identifier: string; name: string; description: string };
export type DeploymentOptions = { version?: string; scope?: string[] };
type Listing<T> = { data: { attributes: T }[]; meta?: { pagination?: { current_page: number; total_pages: number } } };
type RemoteFile = { name: string; is_file: boolean; size: number };

function segment(value: string): string {
	if (!/^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(value)) throw new Error("Invalid Maven path segment");
	return encodeURIComponent(value);
}

export function parseXml(xml: string): any {
	if (xml.includes("<!DOCTYPE") || XMLValidator.validate(xml) !== true) throw new Error("Invalid Maven XML");
	return parser.parse(xml);
}

// The property is a comma-separated list, e.g. "paper-plugin,velocity-plugin" for a JAR that runs on both.
export function deploymentTypes(pom: string): DeploymentType[] | undefined {
	const value = parseXml(pom).project?.properties?.["sneakyrp.deployment.type"];
	if (typeof value !== "string") return;
	const types = [...new Set(value.split(",").map((type) => type.trim()))];
	if (!types.every((type): type is DeploymentType => TYPES.includes(type as DeploymentType))) return;
	// A Paper server needs exactly one destination for the JAR.
	if (types.includes("paper-plugin") && types.includes("ignite-mod")) return;
	return types;
}

export function isProxy(server: Pick<Server, "description">): boolean {
	return server.description?.includes(PROXY_PHRASE) ?? false;
}

// Proxies only take Velocity plugins; other servers only take Paper plugins and Ignite mods.
function typeFor(types: DeploymentType[], server: Pick<Server, "description">): DeploymentType | undefined {
	return types.find((type) => (type === "velocity-plugin") === isProxy(server));
}

export function compatible(types: DeploymentType[], server: Pick<Server, "description">): boolean {
	return typeFor(types, server) !== undefined;
}

// The destination depends on the server being deployed to, not on the artifact.
export function destination(types: DeploymentType[], server: Pick<Server, "description">): string {
	const type = typeFor(types, server);
	if (!type) throw new Error(`${types.join(", ")} releases cannot be deployed to ${isProxy(server) ? "a proxy" : "a non-proxy server"}`);
	if (type === "ignite-mod") return "/mods";
	// Velocity has no update folder; the new JAR loads on the next proxy restart.
	if (type === "velocity-plugin") return "/plugins";
	// Paper consumes staged updates on startup and needs the installed JAR to find them.
	return "/plugins/.update";
}

export function artifactSource(pom: string, version: string): ArtifactSource | undefined {
	const project = parseXml(pom).project;
	const url = project?.scm?.url ?? project?.url;
	if (typeof url !== "string") return;
	const repository = /^https:\/\/github\.com\/(Team-Sneakymouse\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(url.trim())?.[1];
	const tag = project?.scm?.tag;
	const commit = (typeof tag === "string" && /^[a-f0-9]{7,40}$/i.test(tag.trim()) ? tag.trim() : undefined) ?? /-([a-f0-9]{7,40})$/i.exec(version)?.[1];
	if (repository && commit) return { repository, commit };
}

export function oldFiles(files: RemoteFile[], artifact: Artifact): string[] {
	const known = new Set(artifact.versions.filter((version) => version !== artifact.version).map((version) => `${artifact.id}-${version}.jar`));
	return files.filter((file) => file.is_file && known.has(file.name)).map((file) => file.name);
}

export class PluginDeployment {
	constructor(
		private host: string,
		private applicationKey: string,
		private clientKey: string,
		private request: typeof fetch = fetch,
	) {
		const url = new URL(host);
		if (url.protocol !== "https:") throw new Error("PELICAN_API_HOST must use HTTPS");
		this.host = host.replace(/\/+$/, "");
	}

	private async get(url: string, init: RequestInit = {}): Promise<Response> {
		const response = await this.request(url, { ...init, signal: AbortSignal.timeout(120_000) });
		if (!response.ok) throw new Error(`Request failed (HTTP ${response.status})`);
		return response;
	}

	private async api<T>(path: string, body?: unknown, api: "client" | "application" = "client"): Promise<T> {
		const response = await this.get(`${this.host}/${api}${path}`, {
			method: body === undefined ? "GET" : "POST",
			headers: {
				Authorization: `Bearer ${api === "application" ? this.applicationKey : this.clientKey}`,
				Accept: "application/json",
				...(body === undefined ? {} : { "Content-Type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
	}

	async servers(scope: string[] = ["Lords of Minecraft"]): Promise<Server[]> {
		const servers: Server[] = [];
		let page = 1;
		while (true) {
			const listing = await this.api<Listing<Server>>(`/servers?page=${page}`, undefined, "application");
			servers.push(...listing.data.map((item) => item.attributes).filter((server) => scope.every((phrase) => server.description?.includes(phrase))));
			if (page >= (listing.meta?.pagination?.total_pages ?? 1)) break;
			page++;
		}
		return servers.sort((a, b) => a.name.localeCompare(b.name));
	}

	async artifact(id: string, requestedVersion?: string): Promise<Artifact | undefined> {
		const base = `${MAVEN}/releases/${GROUP}/${segment(id)}`;
		const readMetadata = async () => parseXml(await (await this.get(`${base}/maven-metadata.xml`)).text()).metadata?.versioning;
		let metadata = requestedVersion === undefined ? await readMetadata() : undefined;
		const version = requestedVersion ?? (metadata?.release || metadata?.latest)?.trim();
		if (!version || version.endsWith("-SNAPSHOT")) return;
		const filename = `${id}-${version}.jar`;
		const release = `${base}/${segment(version)}/${segment(id)}-${segment(version)}`;
		const pom = await (await this.get(`${release}.pom`)).text();
		const types = deploymentTypes(pom);
		if (!types) return;
		// Exact-version webhooks can reject libraries before metadata is published or readable.
		metadata ??= await readMetadata();
		const published = metadata.versions?.version ?? [];
		const versions: string[] = (Array.isArray(published) ? published : [published]).map((value: string) => value.trim());
		versions.forEach(segment);
		const source = artifactSource(pom, version);
		const lastUpdated = metadata.lastUpdated?.trim();
		return {
			id, version, types, versions, filename, url: `${release}.jar`, ...(source ? { source } : {}),
			...(typeof lastUpdated === "string" && /^\d{14}$/.test(lastUpdated) ? { lastUpdated } : {}),
		};
	}

	async catalog(): Promise<{ artifacts: Artifact[]; failures: string[] }> {
		const listing = (await (await this.get(`${MAVEN}/api/maven/details/releases/${GROUP}`)).json()) as { files: { name: string; type: string }[] };
		const artifacts: Artifact[] = [];
		const failures: string[] = [];
		const directories = listing.files.filter((file) => file.type === "DIRECTORY");
		// Bound repository traffic while reading every artifact's latest POM.
		for (let offset = 0; offset < directories.length; offset += 5) {
			await Promise.all(
				directories.slice(offset, offset + 5).map(async ({ name }) => {
					try {
						const artifact = await this.artifact(name);
						if (artifact) artifacts.push(artifact);
					} catch {
						failures.push(name);
					}
				}),
			);
		}
		return {
			artifacts: artifacts.sort((a, b) => (b.lastUpdated ?? "").localeCompare(a.lastUpdated ?? "") || b.version.localeCompare(a.version) || a.id.localeCompare(b.id)),
			failures,
		};
	}

	private async files(server: string, directory: string): Promise<RemoteFile[]> {
		const result = await this.api<Listing<RemoteFile>>(`/servers/${encodeURIComponent(server)}/files/list?directory=${encodeURIComponent(directory)}`);
		return result.data.map((file) => file.attributes);
	}

	private async ensureDirectory(server: string, directory: string): Promise<void> {
		let root = "/";
		for (const name of directory.split("/").filter(Boolean)) {
			const existing = (await this.files(server, root)).find((file) => file.name === name);
			if (existing?.is_file) throw new Error(`${root}${name} is a file`);
			if (!existing) await this.api(`/servers/${encodeURIComponent(server)}/files/create-folder`, { root, name });
			root = `${root}${name}/`;
		}
	}

	async announceUpdate(server: string, artifact: Pick<Artifact, "id" | "version">): Promise<void> {
		await this.api(`/servers/${encodeURIComponent(server)}/command`, {
			command: `say Plugin ${artifact.id} ${artifact.version} updated. Restart the server to load it`,
		});
	}

	async deploy(server: string, id: string, options: DeploymentOptions = {}): Promise<Artifact> {
		const current = await this.api<{ attributes: Server }>(`/servers/${encodeURIComponent(server)}`);
		if (!(options.scope ?? ["Lords of Minecraft"]).every((phrase) => current.attributes.description?.includes(phrase)))
			throw new Error("Client server description does not confirm deployment scope");
		const artifact = await this.artifact(id, options.version);
		if (!artifact) throw new Error("Latest release is no longer eligible for deployment");
		// Checked before downloading or touching any server files.
		const directory = destination(artifact.types, current.attributes);
		const jar = await (await this.get(artifact.url)).arrayBuffer();
		const bytes = new Uint8Array(jar);
		if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("Release is not a JAR archive");
		await this.ensureDirectory(server, directory);
		const signed = await this.api<{ attributes: { url: string } }>(`/servers/${encodeURIComponent(server)}/files/upload`);
		const upload = new URL(signed.attributes.url);
		if (upload.protocol !== "https:") throw new Error("Upload URL must use HTTPS");
		upload.searchParams.set("directory", directory);
		const form = new FormData();
		form.append("files", new Blob([jar], { type: "application/java-archive" }), artifact.filename);
		await this.get(upload.toString(), { method: "POST", body: form });
		const uploaded = await this.files(server, directory);
		if (!uploaded.some((file) => file.is_file && file.name === artifact.filename && file.size === jar.byteLength)) {
			throw new Error("Upload could not be verified; previous versions were kept");
		}
		try {
			const previous = oldFiles(uploaded, artifact);
			if (previous.length) await this.api(`/servers/${encodeURIComponent(server)}/files/delete`, { root: directory, files: previous });
		} catch {
			throw new Error(`${artifact.version} uploaded, but cleanup failed; check for older JARs before restarting`);
		}
		return artifact;
	}
}
