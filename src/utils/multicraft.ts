import crypto from "crypto";
import axios from "axios";
import FormData from "form-data";

export default class MulticraftAPI {
	url: string;
	user: string;
	apiKey: string;

	constructor(url: string, user: string, apiKey: string) {
		if (!url || !user || !apiKey) throw new Error("Invalid Multicraft API credentials");

		this.url = url;
		this.user = user;
		this.apiKey = apiKey;
	}

	async call<T extends keyof MulticraftMethods>(method: T, params: MulticraftMethods[T]) {
		const apiParams = this.addDefaults(method, {
			_MulticraftAPIMethod: method,
			_MulticraftAPIUser: this.user,
			...params,
		});

		let str = "";
		let query = "";
		for (let [key, value] of Object.entries(apiParams)) {
			if (Array.isArray(value)) {
				value = JSON.stringify(value);
			} else if (typeof value === "number") {
				value = value.toString();
			}
			str += key + value;
			query += `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
		}

		const hmac = crypto.createHmac("sha256", this.apiKey).update(str).digest("hex");
		apiParams["_MulticraftAPIKey"] = hmac;
		query += `&_MulticraftAPIKey=${hmac}`;

		return (
			await axios.post(this.url, query, {
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
			})
		).data as MulticraftResponse<T>;
	}

	addDefaults<T extends keyof MulticraftMethods>(method: T, params: MulticraftMethods[T]) {
		const newParams: ApiParams<T> = {
			_MulticraftAPIMethod: method,
			_MulticraftAPIUser: this.user,
			...params,
		};

		switch (method) {
			case "updateUser":
				(newParams as unknown as ApiParams<"updateUser">).send_mail ??= 0;
				break;
			case "createUser":
				(newParams as unknown as ApiParams<"createUser">).lang ??= "";
				(newParams as unknown as ApiParams<"createUser">).send_mail ??= 0;
				break;
			case "getOwnApiKey":
				(newParams as unknown as ApiParams<"getOwnApiKey">).generate ??= 0;
				(newParams as unknown as ApiParams<"getOwnApiKey">).gauth_code ??= "";
				break;
			case "createPlayer":
				(newParams as unknown as ApiParams<"createPlayer">).op_command ??= 0;
			case "findServers":
				(newParams as unknown as ApiParams<"findServers">).details ??= 0;
				break;
			case "createServerOn":
				(newParams as unknown as ApiParams<"createServerOn">).daemon_id ??= 0;
				(newParams as unknown as ApiParams<"createServerOn">).no_commands ??= 0;
				(newParams as unknown as ApiParams<"createServerOn">).no_setup_script ??= 0;
				break;
			case "createServer":
				(newParams as unknown as ApiParams<"createServer">).name ??= "";
				(newParams as unknown as ApiParams<"createServer">).port ??= 0;
				(newParams as unknown as ApiParams<"createServer">).base ??= "";
				(newParams as unknown as ApiParams<"createServer">).players ??= 0;
				(newParams as unknown as ApiParams<"createServer">).no_commands ??= 0;
				(newParams as unknown as ApiParams<"createServer">).no_setup_script ??= 0;
				break;
			case "createAndConfigureServer":
				(newParams as unknown as ApiParams<"createAndConfigureServer">).no_commands ??= 0;
				(newParams as unknown as ApiParams<"createAndConfigureServer">).no_setup_script ??= 0;
				break;
			case "suspendServer":
				(newParams as unknown as ApiParams<"suspendServer">).stop ??= 1;
				break;
			case "resumeServer":
				(newParams as unknown as ApiParams<"resumeServer">).start ??= 1;
				break;
			case "deleteServer":
				(newParams as unknown as ApiParams<"deleteServer">).delete_dir ??= "no";
				(newParams as unknown as ApiParams<"deleteServer">).delete_user ??= "no";
				break;
			case "getServerStatus":
				(newParams as unknown as ApiParams<"getServerStatus">).player_list ??= 0;
				break;
			case "runCommand":
				(newParams as unknown as ApiParams<"runCommand">).run_for ??= 0;
				break;
			case "addServerPort":
				(newParams as unknown as ApiParams<"addServerPort">).port ??= 0;
				break;
			case "getConnectionMemory":
				(newParams as unknown as ApiParams<"getConnectionMemory">).include_suspended ??= 0;
				break;
			case "getStatistics":
				(newParams as unknown as ApiParams<"getStatistics">).id ??= 0;
				(newParams as unknown as ApiParams<"getStatistics">).include_suspended ??= 0;
				break;
			case "runScript":
				(newParams as unknown as ApiParams<"runScript">).args ??= "";
				break;
		}
		return newParams;
	}
}

type ApiParams<T extends keyof MulticraftMethods> = {
	_MulticraftAPIMethod: T;
	_MulticraftAPIUser: string;
	_MulticraftAPIKey?: string;
} & MulticraftMethods[T];

type MulticraftResponse<T extends keyof MulticraftMethods> = {
	success: boolean;
	errors: unknown[];
	data: MulticraftResponses[T];
};

type MulticraftMethods = {
	//User functions
	listUsers: {};
	findUsers: { field: string[]; value: string[] };
	getUser: { id: number };
	getCurrentUser: {};
	updateUser: { id: number; field: string[]; value: string[]; send_mail: number };
	createUser: { name: string; email: string; password: string; lang?: string; send_mail: number };
	deleteUser: { id: number };
	getUserRole: { user_id: string; server_id: number };
	setUserRole: { user_id: string; server_id: number; role: string };
	getUserFtpAccess: { user_id: string; server_id: number };
	setUserFtpAccess: { user_id: string; server_id: number; mode: string };
	getUserId: { name: string };
	validateUser: { name: string; password: string };
	generateUserApiKey: { user_id: string };
	getUserApiKey: { user_id: string };
	removeUserApiKey: { user_id: string };
	getOwnApiKey: { password: string; generate: number; gauth_code: string };
	//Player functions
	listPlayers: { server_id: number };
	findPlayers: { server_id: number; field: string[]; value: string[] };
	getPlayer: { id: number };
	updatePlayer: { id: number; field: string[]; value: string[] };
	createPlayer: { server_id: number; name: string; op_command: number };
	deletePlayer: { id: number };
	assignPlayerToUser: { player_id: number; user_id: number };
	//Command functions
	listCommands: { server_id: number };
	findCommands: { server_id: number; field: string[]; value: string[] };
	getCommand: { id: number };
	updateCommand: { id: number; field: string[]; value: string[] };
	createCommand: { server_id: number; name: string; role: string; chat: string; response: string; run: string };
	deleteCommand: { id: number };
	//Server functions
	listServers: {};
	findServers: { field: string[]; value: string[]; details: number };
	listServersByConnection: { connection_id: number };
	listServersByOwner: { user_id: number };
	getServer: { id: number };
	updateServer: { id: number; field: string[]; value: string[] };
	createServerOn: { daemon_id: number; no_commands: number; no_setup_script: number };
	createServer: {
		name: string;
		port: number;
		base: string;
		players: number;
		no_commands: number;
		no_setup_script: number;
	};
	createAndConfigureServer: {
		field: string[];
		value: string[];
		configField: string[];
		configValue: string[];
		no_commands: number;
		no_setup_script: number;
	};
	suspendServer: { id: number; stop: number };
	resumeServer: { id: number; start: number };
	deleteServer: { id: number; delete_dir: string; delete_user: string };
	getServerStatus: { id: number; player_list: number };
	getServerOwner: { server_id: number };
	setServerOwner: { server_id: number; user_id: string; send_mail: number };
	getServerConfig: { id: number };
	updateServerConfig: { id: number; field: string[]; value: string[] };
	startServerBackup: { id: number };
	getServerBackupStatus: { id: number };
	startServer: { id: number };
	stopServer: { id: number };
	restartServer: { id: number };
	killServer: { id: number };
	startAllServers: {};
	stopAllServers: {};
	restartAllServers: {};
	killAllServers: {};
	sendConsoleCommand: { server_id: number; command: string };
	sendAllConsoleCommand: { command: string };
	runCommand: { server_id: number; command_id: string; run_for: number };
	getServerLog: { id: number };
	clearServerLog: { id: number };
	getServerChat: { id: number };
	clearServerChat: { id: number };
	sendServerControl: { id: number; command: string };
	getServerResources: { id: number };
	moveServer: { server_id: number; daemon_id: string };
	getMoveStatus: { server_id: number };
	listServerPorts: { id: number };
	addServerPort: { id: number; port: number };
	removeServerPort: { id: number; port: number };
	//Daemon functions
	listConnections: {};
	findConnections: { field: string[]; value: string[] };
	getConnection: { id: number };
	removeConnection: { id: number };
	getConnectionStatus: { id: number };
	getConnectionMemory: { id: number; include_suspended: number };
	getStatistics: { id: number; include_suspended: number };
	runScript: { daemon_id: string; script: string; args: string };
	getScript: { daemon_id: string; scriptId: string };
	//Settings functions
	listSettings: {};
	getSetting: { key: string };
	setSetting: { key: string; value: string };
	deleteSetting: { key: string };
	//Schedule functions
	listSchedules: { server_id: number };
	findSchedules: { server_id: number; field: string[]; value: string[] };
	getSchedule: { id: number };
	updateSchedule: { id: number; field: string[]; value: string[] };
	createSchedule: { server_id: number; name: string; ts: string; interval: string; cmd: string; status: string; for: string };
	deleteSchedule: { id: number };
	//Database functions
	getDatabaseInfo: { server_id: number };
	createDatabase: { server_id: number };
	changeDatabasePassword: { server_id: number };
	deleteDatabase: { server_id: number };
};

type MulticraftResponses = {
	//User functions
	listUsers: unknown;
	findUsers: unknown;
	getUser: unknown;
	getCurrentUser: unknown;
	updateUser: unknown;
	createUser: unknown;
	deleteUser: unknown;
	getUserRole: unknown;
	setUserRole: unknown;
	getUserFtpAccess: unknown;
	setUserFtpAccess: unknown;
	getUserId: unknown;
	validateUser: unknown;
	generateUserApiKey: unknown;
	getUserApiKey: unknown;
	removeUserApiKey: unknown;
	getOwnApiKey: unknown;
	//Player functions
	listPlayers: unknown;
	findPlayers: unknown;
	getPlayer: unknown;
	updatePlayer: unknown;
	createPlayer: unknown;
	deletePlayer: unknown;
	assignPlayerToUser: unknown;
	//Command functions
	listCommands: unknown;
	findCommands: unknown;
	getCommand: unknown;
	updateCommand: unknown;
	createCommand: unknown;
	deleteCommand: unknown;
	//Server functions
	listServers: unknown;
	findServers: unknown;
	listServersByConnection: unknown;
	listServersByOwner: unknown;
	getServer: unknown;
	updateServer: unknown;
	createServerOn: unknown;
	createServer: unknown;
	createAndConfigureServer: unknown;
	suspendServer: unknown;
	resumeServer: unknown;
	deleteServer: unknown;
	getServerStatus: {
		status: "online" | "offline";
		onlinePLayers: `${number}`;
		players: { id: `${number}`; name: string; ip: string }[];
		maxPlayers: `${number}`;
	};
	getServerOwner: unknown;
	setServerOwner: unknown;
	getServerConfig: unknown;
	updateServerConfig: unknown;
	startServerBackup: unknown;
	getServerBackupStatus: unknown;
	startServer: unknown;
	stopServer: unknown;
	restartServer: unknown;
	killServer: unknown;
	startAllServers: unknown;
	stopAllServers: unknown;
	restartAllServers: unknown;
	killAllServers: unknown;
	sendConsoleCommand: unknown;
	sendAllConsoleCommand: unknown;
	runCommand: unknown;
	getServerLog: unknown;
	clearServerLog: unknown;
	getServerChat: unknown;
	clearServerChat: unknown;
	sendServerControl: unknown;
	getServerResources: unknown;
	moveServer: unknown;
	getMoveStatus: unknown;
	listServerPorts: unknown;
	addServerPort: unknown;
	removeServerPort: unknown;
	//Daemon functions
	listConnections: unknown;
	findConnections: unknown;
	getConnection: unknown;
	removeConnection: unknown;
	getConnectionStatus: unknown;
	getConnectionMemory: unknown;
	getStatistics: unknown;
	runScript: unknown;
	getScript: unknown;
	//Settings functions
	listSettings: unknown;
	getSetting: unknown;
	setSetting: unknown;
	deleteSetting: unknown;
	//Schedule functions
	listSchedules: unknown;
	findSchedules: unknown;
	getSchedule: unknown;
	updateSchedule: unknown;
	createSchedule: unknown;
	deleteSchedule: unknown;
	//Database functions
	getDatabaseInfo: unknown;
	createDatabase: unknown;
	changeDatabasePassword: unknown;
	deleteDatabase: unknown;
};
