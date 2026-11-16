import assert from "node:assert/strict";
import { test } from "node:test";
import { data } from "../src/PluginUpdates.ts";
import { type Artifact, deploymentTypes, type Fetch, type MavenOptions, mavenOptions, oldFiles, PluginDeployment } from "../src/utils/PluginDeployment.ts";

const metadata = `<metadata><versioning><release>2.0</release><latest>3.0-SNAPSHOT</latest><versions><version>1.0</version><version>2.0</version></versions></versioning></metadata>`;
const pom = (type: string) => `<project><properties><sneakyrp.deployment.type>${type}</sneakyrp.deployment.type></properties></project>`;
const file = (name: string, size = 4) => ({ name, is_file: true, size });
const listing = (files: unknown[]) => ({ data: files.map((attributes) => ({ attributes })) });

test("catalog sorts same-day releases by precise Maven update time before version hashes", async () => {
	const request: Fetch = async (input) => {
		const url = String(input);
		if (url.includes("/api/maven/details/")) return Response.json({ files: ["Older", "Newer"].map((name) => ({ name, type: "DIRECTORY" })) });
		if (url.endsWith(".pom")) return new Response(pom("paper-plugin"));
		const newer = url.includes("/Newer/");
		return new Response(
			`<metadata><versioning><release>2026.10.18-${newer ? "aaaa" : "ffff"}</release><lastUpdated>20261018${newer ? "140000" : "130000"}</lastUpdated></versioning></metadata>`,
		);
	};
	const catalog = await new PluginDeployment("https://panel.example", "application", "client", request).catalog();
	assert.deepEqual(catalog.failures, []);
	assert.deepEqual(
		catalog.artifacts.map(({ id, lastUpdated }) => ({ id, lastUpdated })),
		[
			{ id: "Newer", lastUpdated: "20261018140000" },
			{ id: "Older", lastUpdated: "20261018130000" },
		],
	);
});

// `installed` and `staged` override the listings of plugins and plugins/.update; by default both contain older copies.
// `maven` is passed to the service as its Maven settings.
function setup(
	type = "paper-plugin",
	failUpload = false,
	failCleanup = false,
	badSize = false,
	description = "Lords of Minecraft - test",
	{ installed, staged, maven }: { installed?: string[]; staged?: string[]; maven?: MavenOptions } = {},
) {
	const events: { url: string; method: string; body?: any; headers: Headers }[] = [];
	let uploaded = false;
	let uploadDirectory: string | null = null;
	const withUpload = (names: string[], directory: string) => [
		...names.map((name) => file(name)),
		...(uploaded && uploadDirectory === directory ? [file("Example-2.0.jar", badSize ? 0 : 4)] : []),
	];
	const request: Fetch = async (input, init) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		events.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body, headers: new Headers(init?.headers) });
		let result: unknown;
		if (url.includes("/api/maven/details/")) return Response.json({ files: [{ name: "Example", type: "DIRECTORY" }] });
		if (url.includes("/application/servers?")) return Response.json(listing([{ identifier: "server", name: "Server", description }]));
		if (url.endsWith("maven-metadata.xml")) return new Response(metadata);
		if (url.endsWith(".pom")) return new Response(pom(type));
		if (url.endsWith(".jar")) return new Response(new Uint8Array([0x50, 0x4b, 3, 4]));
		if (url.includes("/upload/file")) {
			if (failUpload) return new Response("failed", { status: 500 });
			uploaded = true;
			uploadDirectory = new URL(url).searchParams.get("directory");
			return new Response(null, { status: 204 });
		}
		if (url.endsWith("/files/upload")) result = { attributes: { url: "https://wings.example/upload/file?token=signed" } };
		else if (url.includes("/files/list")) {
			const directory = new URL(url).searchParams.get("directory");
			if (directory === "/")
				result = listing([
					{ name: "plugins", is_file: false },
					{ name: "mods", is_file: false },
				]);
			else if (directory === "/plugins/") result = listing([{ name: ".update", is_file: false }]);
			else if (directory === "/plugins" && installed) result = listing([{ name: ".update", is_file: false }, ...withUpload(installed, directory)]);
			else if (directory === "/plugins/.update" && staged) result = listing(withUpload(staged, directory));
			else
				result = listing([
					file("Example-1.0.jar"),
					file("Example-1.0-sources.jar"),
					file("Example-Other-1.0.jar"),
					...(uploaded ? [file("Example-2.0.jar", badSize ? 0 : 4)] : []),
				]);
		} else if (url.endsWith("/files/delete")) return new Response(null, { status: failCleanup ? 500 : 204 });
		else if (url.endsWith("/client/servers/server")) result = { attributes: { description } };
		else throw new Error(`Unexpected request ${url}`);
		return Response.json(result);
	};
	return { service: new PluginDeployment("https://panel.example/api/", "application-secret", "client-secret", request, maven), events };
}

const MAVEN_ORIGIN = "https://maven.sneakyrp.com";
// One kind per Maven request the service makes; every other request goes to Pelican or its upload URL.
function mavenKind(url: string): "listing" | "metadata" | "pom" | "jar" | undefined {
	if (!url.startsWith(`${MAVEN_ORIGIN}/`)) return;
	if (url.startsWith(`${MAVEN_ORIGIN}/api/maven/details/`)) return "listing";
	if (url.endsWith("/maven-metadata.xml")) return "metadata";
	return url.endsWith(".pom") ? "pom" : url.endsWith(".jar") ? "jar" : assert.fail(`Unexpected Maven request ${url}`);
}
// Lists the catalog, deploys a release and lists servers: every kind of request the service can send.
async function everyRequest(maven?: MavenOptions) {
	const { service, events } = setup("paper-plugin", false, false, false, undefined, { maven });
	assert.deepEqual(
		(await service.catalog()).artifacts.map((artifact) => artifact.id),
		["Example"],
	);
	await service.deploy("server", "Example");
	await service.servers();
	return events;
}

test("Maven credentials are sent as Basic authorization with every Maven read and to no other host", async () => {
	// RFC 7617's example pair.
	const events = await everyRequest({ username: "Aladdin", password: "open sesame" });
	const authorization = (event: (typeof events)[number]) => event.headers.get("Authorization");
	for (const kind of ["listing", "metadata", "pom", "jar"]) {
		const requests = events.filter((event) => mavenKind(event.url) === kind);
		assert.ok(requests.length, `No ${kind} request was sent`);
		for (const event of requests) assert.equal(authorization(event), "Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==", event.url);
	}
	const others = events.filter((event) => !mavenKind(event.url));
	const sentTo = (prefix: string) => others.filter((event) => event.url.startsWith(prefix));
	const client = sentTo("https://panel.example/api/client/");
	const application = sentTo("https://panel.example/api/application/");
	const uploads = sentTo("https://wings.example/upload/file");
	assert.ok(client.length && application.length);
	assert.equal(uploads.length, 1);
	assert.equal(client.length + application.length + uploads.length, others.length);
	for (const event of client) assert.equal(authorization(event), "Bearer client-secret");
	for (const event of application) assert.equal(authorization(event), "Bearer application-secret");
	assert.equal(authorization(uploads[0]), null);
});

test("Maven reads stay anonymous unless both the username and the password are set", async () => {
	for (const maven of [
		undefined,
		{},
		{ username: "Aladdin" },
		{ password: "open sesame" },
		{ username: "", password: "open sesame" },
		{ username: "Aladdin", password: "" },
	]) {
		const requests = (await everyRequest(maven)).filter((event) => mavenKind(event.url));
		assert.deepEqual(new Set(requests.map((event) => mavenKind(event.url))), new Set(["listing", "metadata", "pom", "jar"]));
		for (const event of requests) assert.equal(event.headers.has("Authorization"), false, event.url);
	}
});

test("Maven credentials never appear in the error of a rejected Maven read", async () => {
	const request: Fetch = async () => new Response("Unauthorized", { status: 401 });
	const service = new PluginDeployment("https://panel.example/api", "application", "client", request, { username: "Aladdin", password: "open sesame" });
	// The whole message is fixed, so it cannot carry the username, the password or their encoded form.
	for (const read of [() => service.artifact("Example"), () => service.artifact("Example", "1.0"), () => service.catalog()])
		await assert.rejects(read(), { message: "Request failed (HTTP 401)" });
});

test("the Maven repository is configurable for every kind of Maven read and defaults to releases", async () => {
	const group = "io/github/team-sneakymouse";
	for (const [maven, repository] of [
		[undefined, "releases"],
		[{ repository: "" }, "releases"],
		[{ repository: "sneakymouse" }, "sneakymouse"],
		[{ repository: "my_repo-2" }, "my_repo-2"],
	] as const) {
		const urls = (await everyRequest(maven)).map((event) => event.url).filter(mavenKind);
		assert.deepEqual(
			[...new Set(urls)].sort(),
			[
				`${MAVEN_ORIGIN}/api/maven/details/${repository}/${group}`,
				`${MAVEN_ORIGIN}/${repository}/${group}/Example/maven-metadata.xml`,
				`${MAVEN_ORIGIN}/${repository}/${group}/Example/2.0/Example-2.0.pom`,
				`${MAVEN_ORIGIN}/${repository}/${group}/Example/2.0/Example-2.0.jar`,
			].sort(),
		);
	}
});

test("an invalid Maven repository is rejected at construction without repeating its value", () => {
	for (const repository of ["releases/private", "../private", "..", "releases?x=1", "re leases", " ", "releases\n", "sneakymouse/"])
		assert.throws(() => new PluginDeployment("https://panel.example/api", "application", "client", undefined, { repository }), {
			message: "MAVEN_REPOSITORY must be a single path segment of letters, digits, _ or -",
		});
});

test("Maven settings come from MAVEN_USERNAME, MAVEN_PASSWORD and MAVEN_REPOSITORY", () => {
	assert.deepEqual(
		mavenOptions({ MAVEN_USERNAME: "Aladdin", MAVEN_PASSWORD: "open sesame", MAVEN_REPOSITORY: "sneakymouse", PELICAN_CLIENT_KEY: "unrelated" }),
		{
			username: "Aladdin",
			password: "open sesame",
			repository: "sneakymouse",
		},
	);
	assert.deepEqual(mavenOptions({}), { username: undefined, password: undefined, repository: undefined });
});

test("only explicit supported deployment properties qualify, including namespaced Maven POMs", () => {
	assert.deepEqual(deploymentTypes(pom("paper-plugin")), ["paper-plugin"]);
	assert.deepEqual(deploymentTypes(pom("ignite-mod")), ["ignite-mod"]);
	assert.deepEqual(deploymentTypes(pom("velocity-plugin")), ["velocity-plugin"]);
	assert.deepEqual(
		deploymentTypes(
			'<project xmlns="http://maven.apache.org/POM/4.0.0"><properties><sneakyrp.deployment.type>paper-plugin</sneakyrp.deployment.type></properties></project>',
		),
		["paper-plugin"],
	);
	assert.equal(
		deploymentTypes("<project><!-- <properties><sneakyrp.deployment.type>paper-plugin</sneakyrp.deployment.type></properties> --></project>"),
		undefined,
	);
	assert.equal(deploymentTypes(pom("library")), undefined);
	assert.throws(() => deploymentTypes('<!DOCTYPE project [<!ENTITY type "paper-plugin">]><project/>'));
});

test("deployment properties accept comma-separated lists but reject unknown entries and ambiguous Paper destinations", () => {
	assert.deepEqual(deploymentTypes(pom(" paper-plugin , velocity-plugin ")), ["paper-plugin", "velocity-plugin"]);
	assert.deepEqual(deploymentTypes(pom("velocity-plugin,velocity-plugin")), ["velocity-plugin"]);
	assert.equal(deploymentTypes(pom("paper-plugin,library")), undefined);
	assert.equal(deploymentTypes(pom("paper-plugin,")), undefined);
	assert.equal(deploymentTypes(pom("paper-plugin,ignite-mod")), undefined);
	// Repeated tags are not a supported list format.
	assert.equal(
		deploymentTypes(
			"<project><properties><sneakyrp.deployment.type>paper-plugin</sneakyrp.deployment.type><sneakyrp.deployment.type>velocity-plugin</sneakyrp.deployment.type></properties></project>",
		),
		undefined,
	);
});

test("cleanup matches exact published old JAR names and leaves classifiers, directories and other artifacts alone", () => {
	const artifact = { id: "Example", version: "2.0", versions: ["1.0", "2.0"] } as Artifact;
	assert.deepEqual(
		oldFiles(
			[
				file("Example-1.0.jar"),
				file("Example-2.0.jar"),
				file("Example-1.0-sources.jar"),
				file("Example-Mod-1.0.jar"),
				file("Example-custom.jar"),
				{ ...file("Example-1.0.jar"), is_file: false },
			],
			artifact,
		),
		["Example-1.0.jar"],
	);
});

test("Paper replacement is verified before staging cleanup and preserves installed plugins; token only goes to the panel", async () => {
	const { service, events } = setup();
	const artifact = await service.deploy("server", "Example");
	assert.equal(artifact.version, "2.0");
	const uploadIndex = events.findIndex((event) => event.url.includes("/upload/file"));
	const upload = events[uploadIndex];
	assert.equal(new URL(upload.url).searchParams.get("directory"), "/plugins/.update");
	assert.equal(upload.headers.has("Authorization"), false);
	const form = upload.body as FormData;
	assert.equal((form.get("files") as File).name, "Example-2.0.jar");
	const deletes = events.filter((event) => event.url.endsWith("/delete"));
	assert.deepEqual(
		deletes.map((event) => event.body),
		[{ root: "/plugins/.update", files: ["Example-1.0.jar"] }],
	);
	assert.ok(events.indexOf(deletes[0]) > uploadIndex + 1);
	for (const event of events) {
		assert.equal(event.headers.get("Authorization"), event.url.startsWith("https://panel.example/api/client/") ? "Bearer client-secret" : null);
		assert.ok(!event.url.includes("/application/"));
	}
	assert.ok(events.every((event) => !event.url.endsWith("/power")));
});

const tellraw = (action: string, last: object) =>
	`tellraw @a ${JSON.stringify(["", { text: "[Plugin] ", color: "gold" }, { text: "Example", color: "aqua" }, { text: action, color: "gray" }, last])}`;

test("update announcements send a colored tellraw with the commit subject using the client API", async () => {
	const request: Fetch = async (input, init) => {
		assert.equal(String(input), "https://panel.example/api/client/servers/dev%20server/command");
		assert.equal(init?.method, "POST");
		assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer client-secret");
		assert.deepEqual(JSON.parse(init?.body as string), { command: tellraw(" updated at 3:05 PM EDT: ", { text: "Fix the thing", color: "white" }) });
		return new Response(null, { status: 204 });
	};
	const service = new PluginDeployment("https://panel.example/api", "application-secret", "client-secret", request);
	await service.announceUpdate("dev server", { id: "Example", version: "2.0", subject: "Fix \u00A7cthe thing\n" }, new Date("2026-07-02T19:05:00Z"));
});

test("new Paper plugins upload into plugins and clear stale staged copies after verification", async () => {
	const { service, events } = setup("paper-plugin", false, false, false, undefined, {
		installed: ["Example-Other-1.0.jar", "Example-1.0-sources.jar"],
		staged: ["Example-1.0.jar", "Example-2.0.jar", "Example-Other-1.0.jar"],
	});
	const deployment = await service.deploy("server", "Example");
	assert.equal(deployment.firstInstall, true);
	const uploadIndex = events.findIndex((event) => event.url.includes("/upload/file"));
	assert.equal(new URL(events[uploadIndex].url).searchParams.get("directory"), "/plugins");
	const deletes = events.filter((event) => event.url.endsWith("/delete"));
	assert.deepEqual(
		deletes.map((event) => event.body),
		[{ root: "/plugins/.update", files: ["Example-1.0.jar", "Example-2.0.jar"] }],
	);
	assert.ok(events.indexOf(deletes[0]) > uploadIndex);
});

test("re-uploading the installed Paper version still stages it and keeps the installed JAR", async () => {
	const { service, events } = setup("paper-plugin", false, false, false, undefined, { installed: ["Example-2.0.jar"], staged: ["Example-1.0.jar"] });
	const deployment = await service.deploy("server", "Example");
	assert.equal(deployment.firstInstall, false);
	assert.equal(new URL(events.find((event) => event.url.includes("/upload/file"))!.url).searchParams.get("directory"), "/plugins/.update");
	assert.deepEqual(
		events.filter((event) => event.url.endsWith("/delete")).map((event) => event.body),
		[{ root: "/plugins/.update", files: ["Example-1.0.jar"] }],
	);
});

test("failed first-install verification never deletes files", async () => {
	const { service, events } = setup("paper-plugin", false, false, true, undefined, { installed: [], staged: ["Example-1.0.jar"] });
	await assert.rejects(service.deploy("server", "Example"), /Upload could not be verified/);
	assert.equal(new URL(events.find((event) => event.url.includes("/upload/file"))!.url).searchParams.get("directory"), "/plugins");
	assert.deepEqual(
		events.filter((event) => event.url.endsWith("/delete")),
		[],
	);
});

test("first-install announcements without a commit subject ask for a restart", async () => {
	const request: Fetch = async (_input, init) => {
		assert.deepEqual(JSON.parse(init?.body as string), {
			command: tellraw(" installed at 2:05 PM EST: ", { text: "Restart the server to load it", color: "yellow" }),
		});
		return new Response(null, { status: 204 });
	};
	const service = new PluginDeployment("https://panel.example/api", "application-secret", "client-secret", request);
	await service.announceUpdate("server", { id: "Example", version: "2.0", firstInstall: true }, new Date("2026-11-02T19:05:00Z"));
});

test("update announcements report command failures to the caller", async () => {
	const request: Fetch = async () => new Response("Server is offline", { status: 502 });
	const service = new PluginDeployment("https://panel.example/api", "application-secret", "client-secret", request);
	await assert.rejects(service.announceUpdate("server", { id: "Example", version: "2.0" }), /HTTP 502/);
});

test("Ignite mods upload and clean up exclusively in mods", async () => {
	const { service, events } = setup("ignite-mod");
	await service.deploy("server", "Example");
	assert.equal(new URL(events.find((event) => event.url.includes("/upload/file"))!.url).searchParams.get("directory"), "/mods");
	assert.deepEqual(
		events.filter((event) => event.url.endsWith("/delete")).map((event) => event.body.root),
		["/mods"],
	);
});

test("Velocity plugins replace older copies directly in plugins on proxies", async () => {
	const { service, events } = setup("velocity-plugin", false, false, false, "Lords of Minecraft Proxy");
	await service.deploy("server", "Example");
	assert.equal(new URL(events.find((event) => event.url.includes("/upload/file"))!.url).searchParams.get("directory"), "/plugins");
	assert.deepEqual(
		events.filter((event) => event.url.endsWith("/delete")).map((event) => event.body),
		[{ root: "/plugins", files: ["Example-1.0.jar"] }],
	);
});

test("dual-platform JARs go to the update folder on Paper servers and plugins on proxies", async () => {
	for (const [description, directory] of [
		["Lords of Minecraft - test", "/plugins/.update"],
		["Lords of Minecraft Proxy", "/plugins"],
	]) {
		const { service, events } = setup("paper-plugin,velocity-plugin", false, false, false, description);
		await service.deploy("server", "Example");
		assert.equal(new URL(events.find((event) => event.url.includes("/upload/file"))!.url).searchParams.get("directory"), directory);
	}
});

test("releases are rejected before upload when the server type does not match", async () => {
	for (const [type, description] of [
		["velocity-plugin", "Lords of Minecraft - test"],
		["paper-plugin", "Lords of Minecraft Proxy"],
		["ignite-mod", "Lords of Minecraft Proxy"],
	]) {
		const { service, events } = setup(type, false, false, false, description);
		await assert.rejects(service.deploy("server", "Example"), /cannot be deployed/);
		assert.equal(
			events.some((event) => event.url.includes("/files/")),
			false,
		);
	}
});

test("failed uploads and failed verification preserve all previous versions", async () => {
	for (const serviceSetup of [setup("paper-plugin", true), setup("paper-plugin", false, false, true)]) {
		await assert.rejects(serviceSetup.service.deploy("server", "Example"));
		assert.equal(
			serviceSetup.events.some((event) => event.url.endsWith("/delete")),
			false,
		);
	}
});

test("cleanup failure reports that the replacement was already uploaded", async () => {
	const { service } = setup("paper-plugin", false, true);
	await assert.rejects(service.deploy("server", "Example"), /2.0 uploaded, but cleanup failed/);
});

test("application server listing paginates, uses client-compatible identifiers and excludes descriptions outside scope", async () => {
	const request: Fetch = async (url, init) => {
		assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer application-secret");
		assert.equal(new URL(String(url)).pathname, "/api/application/servers");
		assert.equal(new URL(String(url)).searchParams.has("type"), false);
		const page = new URL(String(url)).searchParams.get("page");
		return Response.json({
			...listing(
				page === "1"
					? [{ id: 12, identifier: "other", name: "Other", description: "Other game" }]
					: [{ id: 42, identifier: "lom", name: "LoM", description: "Test Lords of Minecraft" }],
			),
			meta: { pagination: { total_pages: 2 } },
		});
	};
	assert.deepEqual(
		(await new PluginDeployment("https://panel.example/api", "application-secret", "client-secret", request).servers()).map((server) => server.identifier),
		["lom"],
	);
});

test("empty application listings do not fall back to client server listing", async () => {
	const queries: string[] = [];
	const request: Fetch = async (input) => {
		const url = new URL(String(input));
		queries.push(url.search);
		assert.equal(url.pathname, "/api/application/servers");
		return Response.json(listing([]));
	};
	const servers = await new PluginDeployment("https://panel.example/api", "application-secret", "client-secret", request).servers();
	assert.deepEqual(servers, []);
	assert.deepEqual(queries, ["?page=1"]);
});

test("scope and latest POM eligibility are checked again immediately before deployment", async () => {
	const { service, events } = setup("library");
	await assert.rejects(service.deploy("server", "Example"), /no longer eligible/);
	assert.ok(events.every((event) => event.method === "GET"));
	const request: Fetch = async () => Response.json({ attributes: { description: "Different game" } });
	await assert.rejects(
		new PluginDeployment("https://panel.example/api", "application-secret", "client-secret", request).deploy("server", "Example"),
		/does not confirm/,
	);
});

test("slash command defaults to administrators and includes update subcommand", () => {
	const command = data[0].toJSON();
	assert.equal(command.default_member_permissions, "8");
	assert.equal(command.options?.[0].name, "update");
});

test("exact-version resolution reads the uploaded version's POM and JAR even when metadata points to a newer release", async () => {
	const urls: string[] = [];
	const request: Fetch = async (input) => {
		const url = String(input);
		urls.push(url);
		if (url.endsWith("maven-metadata.xml")) return new Response(metadata);
		assert.ok(url.endsWith("/Example/1.0/Example-1.0.pom"));
		return new Response(pom("ignite-mod"));
	};
	const artifact = await new PluginDeployment("https://panel.example/api", "application", "client", request).artifact("Example", "1.0");
	assert.equal(artifact?.version, "1.0");
	assert.deepEqual(artifact?.types, ["ignite-mod"]);
	assert.ok(artifact?.url.endsWith("/Example/1.0/Example-1.0.jar"));
	assert.equal(urls.length, 2);
});

test("automatic discovery and final client check require both description phrases", async () => {
	const request: Fetch = async (input) => {
		const url = String(input);
		if (url.includes("/application/servers?"))
			return Response.json(
				listing([
					{ identifier: "live", name: "Live", description: "Lords of Minecraft" },
					{ identifier: "other", name: "Other", description: "Dev Server" },
					{ identifier: "dev", name: "Dev", description: "Lords of Minecraft Dev Server" },
				]),
			);
		assert.ok(url.endsWith("/client/servers/dev"));
		return Response.json({ attributes: { description: "Lords of Minecraft" } });
	};
	const service = new PluginDeployment("https://panel.example/api", "application", "client", request);
	const scope = ["Lords of Minecraft", "Dev Server"];
	assert.deepEqual(
		(await service.servers(scope)).map((server) => server.identifier),
		["dev"],
	);
	await assert.rejects(service.deploy("dev", "Example", { version: "1.0", scope }), /does not confirm/);
});

test("presence reports exact release JARs installed or staged, older published versions, per destination and treats unreadable folders as empty", async () => {
	const listed: string[] = [];
	const request: Fetch = async (input) => {
		const directory = new URL(String(input)).searchParams.get("directory")!;
		listed.push(directory);
		if (directory === "/plugins") return Response.json(listing([file("Paper-2.0.jar"), file("Staged-1.0.jar"), { name: "Both-2.0.jar", is_file: false }]));
		if (directory === "/plugins/.update") return Response.json(listing([file("Staged-2.0.jar"), file("Paper-2.0.jar"), file("Old-1.0.jar")]));
		return new Response("missing", { status: 404 });
	};
	const service = new PluginDeployment("https://panel.example/api", "application-secret", "client-secret", request);
	const release = (id: string, types: Artifact["types"]): Artifact => ({
		id,
		version: "2.0",
		types,
		versions: ["1.0", "2.0"],
		url: "",
		filename: `${id}-2.0.jar`,
	});
	const presence = await service.presence({ identifier: "server", name: "Server", description: "Lords of Minecraft" }, [
		release("Paper", ["paper-plugin"]),
		release("Staged", ["paper-plugin"]),
		release("Old", ["paper-plugin"]),
		release("Both", ["paper-plugin", "velocity-plugin"]),
		release("Mod", ["ignite-mod"]),
		release("Proxy", ["velocity-plugin"]),
	]);
	assert.deepEqual(Object.fromEntries(presence), {
		Paper: { installed: true, staged: true, outdated: false },
		Staged: { installed: false, staged: true, outdated: true },
		Old: { installed: false, staged: false, outdated: true },
		Both: { installed: false, staged: false, outdated: false },
		Mod: { installed: false, staged: false, outdated: false },
	});
	assert.deepEqual(listed.sort(), ["/mods", "/plugins", "/plugins/.update"]);
});
