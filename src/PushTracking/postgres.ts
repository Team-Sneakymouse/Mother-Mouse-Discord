import type { SQL } from "bun";
import type { Push, PushDetails, PushStore, Stage } from "./store.js";

// Each entry runs once, in order, inside a transaction. Never edit an applied migration; append a new one.
const MIGRATIONS = [
	`
	create table push_tracking.deliveries (
		id text primary key,
		source text not null,
		received_at timestamptz not null default now()
	);
	create table push_tracking.pushes (
		id integer generated always as identity primary key,
		repo text not null,
		sha text not null,
		before_sha text,
		pusher text,
		commits jsonb,
		compare_url text,
		forced boolean not null default false,
		superseded boolean not null default false,
		deployed_via integer references push_tracking.pushes(id),
		message_id text,
		version integer not null default 1,
		rendered_version integer not null default 0,
		created_at timestamptz not null default now(),
		updated_at timestamptz not null default now()
	);
	create unique index pushes_repo_sha on push_tracking.pushes (lower(repo), sha);
	create index pushes_pending_render on push_tracking.pushes (id) where version > rendered_version;
	create table push_tracking.stages (
		push_id integer not null references push_tracking.pushes(id) on delete cascade,
		kind text not null,
		key text not null,
		status text not null,
		detail jsonb not null default '{}',
		created_at timestamptz not null default now(),
		updated_at timestamptz not null default now(),
		primary key (push_id, kind, key)
	);
	`,
];

type Row = {
	id: number;
	repo: string;
	sha: string;
	before_sha: string | null;
	pusher: string | null;
	commits: unknown;
	compare_url: string | null;
	forced: boolean;
	superseded: boolean;
	deployed_via: number | null;
	message_id: string | null;
	version: number;
	rendered_version: number;
};

const json = (value: unknown) => (typeof value === "string" ? JSON.parse(value) : value);

function push(row: Row): Push {
	return {
		id: row.id,
		repo: row.repo,
		sha: row.sha,
		before: row.before_sha,
		pusher: row.pusher,
		commits: json(row.commits) ?? null,
		compareUrl: row.compare_url,
		forced: row.forced,
		superseded: row.superseded,
		deployedVia: row.deployed_via,
		messageId: row.message_id,
		version: row.version,
		renderedVersion: row.rendered_version,
	};
}

export async function migrate(sql: SQL): Promise<void> {
	await sql.begin(async (tx) => {
		// Serialize concurrent starts (e.g. an old and a new container overlapping during an update).
		await tx`select pg_advisory_xact_lock(hashtext('push_tracking.migrations'))`;
		await tx.unsafe("create schema if not exists push_tracking");
		await tx.unsafe("create table if not exists push_tracking.migrations (version integer primary key, applied_at timestamptz not null default now())");
		const [{ current }] = await tx<{ current: number }>`select coalesce(max(version), 0)::integer as current from push_tracking.migrations`;
		for (let version = current + 1; version <= MIGRATIONS.length; version++) {
			await tx.unsafe(MIGRATIONS[version - 1]);
			await tx`insert into push_tracking.migrations (version) values (${version})`;
		}
	});
}

export class PostgresPushStore implements PushStore {
	constructor(private sql: SQL) {}

	async claimDelivery(id: string, source: string): Promise<boolean> {
		const rows = await this.sql`insert into push_tracking.deliveries (id, source) values (${id}, ${source}) on conflict do nothing returning id`;
		return rows.length > 0;
	}
	async releaseDelivery(id: string): Promise<void> {
		await this.sql`delete from push_tracking.deliveries where id = ${id}`;
	}
	/** Deletes old delivery IDs; GitHub only offers redelivery of recent events. */
	async pruneDeliveries(days: number): Promise<void> {
		await this.sql`delete from push_tracking.deliveries where received_at < now() - make_interval(days => ${days})`;
	}
	async upsertPush(repo: string, sha: string, details?: PushDetails): Promise<Push> {
		if (!details) {
			const [row] = await this.sql<Row>`
				insert into push_tracking.pushes (repo, sha) values (${repo}, ${sha})
				on conflict (lower(repo), sha) do update set repo = push_tracking.pushes.repo
				returning *`;
			return push(row);
		}
		const commits = details.commits ? JSON.stringify(details.commits) : null;
		const [row] = await this.sql<Row>`
			insert into push_tracking.pushes (repo, sha, before_sha, pusher, commits, compare_url, forced)
			values (${repo}, ${sha}, ${details.before}, ${details.pusher}, ${commits}::jsonb, ${details.compareUrl}, ${details.forced})
			on conflict (lower(repo), sha) do update set
				repo = excluded.repo,
				before_sha = excluded.before_sha,
				pusher = excluded.pusher,
				commits = excluded.commits,
				compare_url = excluded.compare_url,
				forced = excluded.forced,
				version = push_tracking.pushes.version + 1,
				updated_at = now()
			returning *`;
		return push(row);
	}
	async get(id: number): Promise<Push | undefined> {
		const [row] = await this.sql<Row>`select * from push_tracking.pushes where id = ${id}`;
		return row && push(row);
	}
	async findByCommit(repo: string, prefix: string): Promise<Push | undefined> {
		const pattern = `${prefix.toLowerCase().replace(/[^a-f0-9]/g, "")}%`;
		const [row] = await this.sql<Row>`
			select * from push_tracking.pushes
			where lower(repo) = lower(${repo}) and sha like ${pattern}
			order by id desc limit 1`;
		return row && push(row);
	}
	async recent(repo: string, limit: number): Promise<Push[]> {
		const rows = await this.sql<Row>`select * from push_tracking.pushes where lower(repo) = lower(${repo}) order by id desc limit ${limit}`;
		return rows.map(push);
	}
	async setStage(pushId: number, stage: Stage): Promise<void> {
		await this.sql.begin(async (tx) => {
			await tx`
				insert into push_tracking.stages (push_id, kind, key, status, detail)
				values (${pushId}, ${stage.kind}, ${stage.key}, ${stage.status}, ${JSON.stringify(stage.detail)}::jsonb)
				on conflict (push_id, kind, key) do update set status = excluded.status, detail = excluded.detail, updated_at = now()`;
			await tx`update push_tracking.pushes set version = version + 1, updated_at = now() where id = ${pushId}`;
		});
	}
	async stages(pushId: number): Promise<Stage[]> {
		const rows = await this.sql<Stage & { detail: unknown }>`
			select kind, key, status, detail from push_tracking.stages where push_id = ${pushId}
			order by case kind when 'workflow' then 0 when 'artifact' then 1 else 2 end, created_at, key`;
		return rows.map((row) => ({ kind: row.kind, key: row.key, status: row.status, detail: json(row.detail) ?? {} }));
	}
	async mark(id: number, patch: { superseded?: boolean; deployedVia?: number }): Promise<void> {
		await this.sql`
			update push_tracking.pushes set
				superseded = coalesce(${patch.superseded ?? null}::boolean, superseded),
				deployed_via = coalesce(${patch.deployedVia ?? null}::integer, deployed_via),
				version = version + 1,
				updated_at = now()
			where id = ${id}`;
	}
	async setMessage(id: number, messageId: string): Promise<void> {
		await this.sql`update push_tracking.pushes set message_id = ${messageId} where id = ${id}`;
	}
	async rendered(id: number, version: number): Promise<void> {
		await this.sql`update push_tracking.pushes set rendered_version = greatest(rendered_version, ${version}) where id = ${id}`;
	}
	async pendingRenders(limit: number): Promise<Push[]> {
		const rows = await this.sql<Row>`select * from push_tracking.pushes where version > rendered_version order by id limit ${limit}`;
		return rows.map(push);
	}
}
