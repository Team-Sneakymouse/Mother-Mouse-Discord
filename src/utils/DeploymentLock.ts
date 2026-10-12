const active = new Set<string>();

/** Shared by manual and webhook deployments within this bot process. */
export function acquireDeploymentLock(server: string): (() => void) | undefined {
	if (active.has(server)) return;
	active.add(server);
	return () => {
		active.delete(server);
	};
}
