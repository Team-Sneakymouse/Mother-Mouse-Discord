import assert from "node:assert/strict";
import { test } from "node:test";
import { data } from "../src/PluginUpdates.ts";
import { type Artifact, deploymentType, oldFiles, PluginDeployment } from "../src/utils/PluginDeployment.ts";

const metadata = `<metadata><versioning><release>2.0</release><latest>3.0-SNAPSHOT</latest><versions><version>1.0</version><version>2.0</version></versions></versioning></metadata>`;
const pom = (type: string) => `<project><properties><sneakyrp.deployment.type>${type}</sneakyrp.deployment.type></properties></project>`;
const file = (name: string, size = 4) => ({ name, is_file: true, size });
const listing = (files: unknown[]) => ({ data: files.map((attributes) => ({ attributes })) });

function setup(type = "paper-plugin", failUpload = false, failCleanup = false, badSize = false) {
	const events: { url: string; method: string; body?: any; headers: Headers }[] = [];
	let uploaded = false;
	const request: typeof fetch = async (input, init) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		events.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body, headers: new Headers(init?.headers) });
		let result: unknown;
		if (url.endsWith("maven-metadata.xml")) return new Response(metadata);
		if (url.endsWith(".pom")) return new Response(pom(type));
		if (url.endsWith(".jar")) return new Response(new Uint8Array([0x50, 0x4b, 3, 4]));
		if (url.includes("/upload/file")) {
			if (failUpload) return new Response("failed", { status: 500 });
			uploaded = true;
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
			else
				result = listing([
					file("Example-1.0.jar"),
					file("Example-1.0-sources.jar"),
					file("Example-Other-1.0.jar"),
					...(uploaded ? [file("Example-2.0.jar", badSize ? 0 : 4)] : []),
				]);
		} else if (url.endsWith("/files/delete")) return new Response(null, { status: failCleanup ? 500 : 204 });
		else if (url.endsWith("/client/servers/server")) result = { attributes: { description: "Lords of Minecraft - test" } };
		else throw new Error(`Unexpected request ${url}`);
		return Response.json(result);
	};
	return { service: new PluginDeployment("https://panel.example/api/", "application-secret", "client-secret", request), events };
}

test("only explicit supported deployment properties qualify, including namespaced Maven POMs", () => {
	assert.equal(deploymentType(pom("paper-plugin")), "paper-plugin");
	assert.equal(deploymentType(pom("ignite-mod")), "ignite-mod");
	assert.equal(
		deploymentType(
			'<project xmlns="http://maven.apache.org/POM/4.0.0"><properties><sneakyrp.deployment.type>paper-plugin</sneakyrp.deployment.type></properties></project>',
		),
		"paper-plugin",
	);
	assert.equal(
		deploymentType("<project><!-- <properties><sneakyrp.deployment.type>paper-plugin</sneakyrp.deployment.type></properties> --></project>"),
		undefined,
	);
	assert.equal(deploymentType(pom("library")), undefined);
	assert.throws(() => deploymentType('<!DOCTYPE project [<!ENTITY type "paper-plugin">]><project/>'));
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

test("update announcements send a console say command using the client API", async () => {
	const request: typeof fetch = async (input, init) => {
		assert.equal(String(input), "https://panel.example/api/client/servers/dev%20server/command");
		assert.equal(init?.method, "POST");
		assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer client-secret");
		assert.deepEqual(JSON.parse(init?.body as string), { command: "say Plugin Example 2.0 updated. Restart the server to load it" });
		return new Response(null, { status: 204 });
	};
	const service = new PluginDeployment("https://panel.example/api", "application-secret", "client-secret", request);
	await service.announceUpdate("dev server", { id: "Example", version: "2.0" });
});

test("update announcements report command failures to the caller", async () => {
	const request: typeof fetch = async () => new Response("Server is offline", { status: 502 });
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
	const request: typeof fetch = async (url, init) => {
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
	const request: typeof fetch = async (input) => {
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
	const request: typeof fetch = async () => Response.json({ attributes: { description: "Different game" } });
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
	const request: typeof fetch = async (input) => {
		const url = String(input);
		urls.push(url);
		if (url.endsWith("maven-metadata.xml")) return new Response(metadata);
		assert.ok(url.endsWith("/Example/1.0/Example-1.0.pom"));
		return new Response(pom("ignite-mod"));
	};
	const artifact = await new PluginDeployment("https://panel.example/api", "application", "client", request).artifact("Example", "1.0");
	assert.equal(artifact?.version, "1.0");
	assert.equal(artifact?.type, "ignite-mod");
	assert.ok(artifact?.url.endsWith("/Example/1.0/Example-1.0.jar"));
	assert.equal(urls.length, 2);
});

test("automatic discovery and final client check require both description phrases", async () => {
	const request: typeof fetch = async (input) => {
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
