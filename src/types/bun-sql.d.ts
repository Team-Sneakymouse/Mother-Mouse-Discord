// Minimal typing for Bun's built-in PostgreSQL client. The project type-checks
// against Node types only, so only the parts used by this bot are declared here.
declare module "bun" {
	export interface SQL {
		<T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
		unsafe<T = Record<string, unknown>>(query: string, values?: unknown[]): Promise<T[]>;
		begin<T>(callback: (tx: SQL) => Promise<T>): Promise<T>;
		close(options?: { timeout?: number }): Promise<void>;
	}
	/** Without a URL, connection settings come from `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` and `PGPORT`. */
	export const SQL: new (
		options?: string | { url?: string; hostname?: string; port?: number; database?: string; username?: string; password?: string; max?: number },
	) => SQL;
}
