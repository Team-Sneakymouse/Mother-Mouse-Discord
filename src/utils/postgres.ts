import { SQL } from "bun";

let shared: SQL | null | undefined;
/** The bot's PostgreSQL connection from the PG* settings, shared by the features that use it; null when PGHOST isn't set. */
export function postgresFromEnv(): SQL | null {
	if (shared === undefined) shared = process.env.PGHOST ? new SQL() : null;
	return shared;
}
