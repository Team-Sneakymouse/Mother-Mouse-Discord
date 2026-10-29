import { createHash } from "node:crypto";
import { MessageFlags, type MessageComponentInteraction, type ModalSubmitInteraction } from "discord.js";
import type { TodoRepository } from "./service.js";
import type { Group } from "./list.js";
const GUILD = "391355330241757205";
type ManagedLabel = { id: string; name: string; repo?: string; description?: string };
const mentions = { parse: [] as [] };
// 128 bits of SHA-256 keep owner + record + route within Discord's 100-character ID limit.
// Hash canonical field arrays (not display placeholders); no process-local modal state or schema field.
const metadataFingerprint = (item: ManagedLabel, group = false) =>
	createHash("sha256")
		.update(JSON.stringify(group ? [item.name] : [item.name, item.repo ?? "", item.description ?? ""]))
		.digest("hex")
		.slice(0, 32);
const route = (owner: string, action: string, id = "", page: number | string = 0) => `todo-manage|${owner}|${action}|${id}|${page}`;
const row = (...components: any[]) => ({ type: 1, components });
const button = (owner: string, label: string, action: string, id = "", page = 0, disabled = false) => ({
	type: 2,
	style: 2,
	label,
	custom_id: route(owner, action, id, page),
	disabled,
});
/** Each picker is a page of at most 25; membership changes add/remove one ID, never replace hidden pages. */
export function renderManagement(labels: ManagedLabel[], groups: Group[], owner: string, mode = "labels", id = "", requested = 0): any {
	const components: any[] = [];
	let content = "Manage labels and nested label groups. Changes save immediately. Nothing is deleted.";
	let embeds: any[] = [];
	if (mode === "label" || mode === "group") {
		const item = mode === "label" ? labels.find((x) => x.id === id) : groups.find((x) => x.id === id);
		if (!item) throw new Error("Selection no longer exists");
		if (mode === "label") {
			const l = item as ManagedLabel;
			embeds = [
				{
					title: l.name,
					description: (l.description ?? "").slice(0, 4000) || "No description configured.",
					fields: [{ name: "Repository", value: l.repo || "Not configured" }],
					footer: {
						text:
							(l.description?.length ?? 0) > 4000
								? "management-description-too-long"
								: `management-empty:${JSON.stringify({ repo: !l.repo, description: !l.description, metadata: metadataFingerprint(l) })}`,
					},
				},
			];
			components.push(row(button(owner, "Edit label", "edit-label", id), button(owner, "Back to labels", "labels")));
		} else {
			const g = item as Group;
			embeds = [
				{
					title: g.name,
					footer: { text: `management-empty:${JSON.stringify({ metadata: metadataFingerprint(g, true) })}` },
					description: `Assigned user: ${g.assigned_user_id ? `<@${g.assigned_user_id}>` : "none"}\nLabels: ${g.labels.length}; nested groups: ${g.child_groups.length}. Use the membership controls to inspect and link/unlink individual members.`,
				},
			];
			components.push(
				row({ type: 5, custom_id: route(owner, "assign", id), placeholder: "Assign this group to a Discord user", min_values: 1, max_values: 1 }),
			);
			components.push(
				row(
					button(owner, "Edit group name", "edit-group", id),
					button(owner, "Clear assigned user", "clear-user", id),
					button(owner, "Back to groups", "groups"),
				),
			);
			components.push(
				row(
					button(owner, "Link labels", "pick-link-label", id),
					button(owner, "Unlink labels", "pick-unlink-label", id),
					button(owner, "Nested groups: link", "pick-link-group", id),
					button(owner, "Nested groups: unlink", "pick-unlink-group", id),
				),
			);
		}
	} else {
		const membership = mode.startsWith("pick-");
		const isGroups = mode === "groups" || mode.endsWith("-group");
		const group = membership ? groups.find((g) => g.id === id) : undefined;
		if (membership && !group) throw new Error("Group no longer exists");
		let candidates: (ManagedLabel | Group)[] = isGroups ? groups : labels;
		if (membership) {
			const refs = isGroups ? group!.child_groups : group!.labels;
			const unlink = mode.startsWith("pick-unlink");
			candidates = candidates.filter((x) => (!isGroups || x.id !== id) && (unlink ? refs.includes(x.id) : !refs.includes(x.id)));
			content = `${group!.name} · ${mode.slice(5).replaceAll("-", " ")}. Select one member to save; existing other members are preserved.`;
		}
		const sorted = [...candidates].sort((a, b) => a.name.localeCompare(b.name));
		const pages = Math.max(1, Math.ceil(sorted.length / 25));
		const page = Math.max(0, Math.min(requested, pages - 1));
		components.push(
			row(
				button(owner, "Labels", "labels"),
				button(owner, "Groups", "groups"),
				button(owner, isGroups ? "New group" : "New label", isGroups ? "new-group" : "new-label"),
			),
		);
		if (sorted.length)
			components.push(
				row({
					type: 3,
					custom_id: route(owner, membership ? mode.slice(5) : isGroups ? "select-group" : "select-label", id, page),
					placeholder: membership ? "Select a member" : "Choose an item to manage",
					min_values: 1,
					max_values: 1,
					options: sorted.slice(page * 25, page * 25 + 25).map((x) => ({ label: x.name, value: x.id })),
				}),
			);
		else content += "\nNo matching items.";
		components.push(
			row(
				button(owner, "Previous", mode, id, page - 1, page === 0),
				button(owner, "Next", mode, id, page + 1, page + 1 >= pages),
				...(membership ? [button(owner, "Back to group", "group", id)] : []),
			),
		);
		content += `\nPage ${page + 1}/${pages}`;
	}
	return { content, embeds, components, attachments: [], files: [], allowedMentions: mentions };
}
export class TodoManagement {
	constructor(private repo: TodoRepository) {}
	async open(guild: string, owner: string) {
		const [labels, groups] = await Promise.all([this.repo.labels(guild), this.repo.groups(guild)]);
		return renderManagement(labels, groups, owner);
	}
	private async authorized(i: MessageComponentInteraction | ModalSubmitInteraction, owner: string) {
		if (i.guildId === GUILD && i.user.id === owner && i.message?.author.id === i.client.user.id) return true;
		await i.reply({
			content: "Only the developer who opened these controls can manage labels in RAWBTV.",
			flags: MessageFlags.Ephemeral,
			allowedMentions: mentions,
		});
		return false;
	}
	async component(i: MessageComponentInteraction): Promise<void> {
		const [, owner, action, id, pageText] = i.customId.split("|");
		if (!(await this.authorized(i, owner))) return;
		if (["new-label", "edit-label", "new-group", "edit-group"].includes(action)) {
			const group = action.endsWith("group"),
				fresh = action.startsWith("new");
			const embed = i.message.embeds?.[0];
			if (!fresh && !group && embed?.footer?.text === "management-description-too-long") {
				await i.reply({
					content: "This description exceeds Discord's 4000-character modal limit. Edit it through the trusted management API; this UI will not truncate it.",
					flags: MessageFlags.Ephemeral,
					allowedMentions: mentions,
				});
				return;
			}
			const empty = embed?.footer?.text?.startsWith("management-empty:") ? JSON.parse(embed.footer.text.slice(17)) : { repo: false, description: false };
			if (!fresh && !/^[a-f0-9]{32}$/.test(empty.metadata ?? "")) {
				await i.reply({
					content: "These controls are outdated; reopen /todo manage before editing.",
					flags: MessageFlags.Ephemeral,
					allowedMentions: mentions,
				});
				return;
			}
			const input = (key: string, label: string, value: string, style = 1, required = true, max = 100) =>
				row({ type: 4, custom_id: key, label, style, required, max_length: max, ...(value ? { value } : {}) });
			await i.showModal({
				custom_id: route(owner, group ? "save-group" : "save-label", fresh ? "" : id, fresh ? 0 : empty.metadata),
				title: `${fresh ? "Create" : "Edit"} ${group ? "group" : "label"}`,
				components: [
					input("name", "Name", fresh ? "" : (embed?.title ?? "")),
					...(!group
						? [
								input("repo", "GitHub repository URL (optional)", fresh || empty.repo ? "" : (embed?.fields[0]?.value ?? ""), 1, false, 500),
								input("description", "Description (optional)", fresh || empty.description ? "" : (embed?.description ?? ""), 2, false, 4000),
							]
						: []),
				],
			});
			return;
		}
		await i.deferUpdate();
		try {
			let mode = action,
				selected = id,
				page = Number(pageText) || 0;
			const values: string[] = "values" in i && Array.isArray(i.values) ? i.values : [];
			if (action === "select-label" || action === "select-group") {
				mode = action.slice(7);
				selected = values[0];
				page = 0;
			} else if (action === "assign" || action === "clear-user") {
				if (action === "assign" && (values.length !== 1 || !/^\d+$/.test(values[0]))) throw new Error("Invalid selected user");
				await this.repo.operation("manage-group", { guild_id: i.guildId, id, actor: owner, assigned_user_id: action === "assign" ? values[0] : "" });
				mode = "group";
			} else if (["link-label", "unlink-label", "link-group", "unlink-group"].includes(action)) {
				if (values.length !== 1) throw new Error("Choose one member");
				await this.repo.operation("manage-group", {
					guild_id: i.guildId,
					id,
					actor: owner,
					membership: {
						field: action.endsWith("group") ? "child_groups" : "labels",
						operation: action.startsWith("unlink") ? "unlink" : "link",
						id: values[0],
					},
				});
				mode = `pick-${action}`;
			}
			if (!["labels", "groups", "label", "group", "pick-link-label", "pick-unlink-label", "pick-link-group", "pick-unlink-group"].includes(mode))
				throw new Error("Unknown management control");
			const [labels, groups] = await Promise.all([this.repo.labels(i.guildId!), this.repo.groups(i.guildId!)]);
			await i.editReply(renderManagement(labels, groups, owner, mode, selected, page));
		} catch {
			await i.editReply({
				content:
					"Management change could not be completed. Refresh with /todo manage; verify the selection belongs to this server and nested groups do not form a cycle.",
				components: [],
				allowedMentions: mentions,
			});
		}
	}
	async modal(i: ModalSubmitInteraction): Promise<void> {
		const [, owner, action, id, expected] = i.customId.split("|");
		if (!(await this.authorized(i, owner))) return;
		await i.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			if (!["save-label", "save-group"].includes(action)) throw new Error("Unknown modal");
			const group = action === "save-group";
			if (id && !/^[a-f0-9]{32}$/.test(expected ?? "")) throw new Error("Missing metadata precondition");
			const payload = {
				guild_id: i.guildId,
				actor: owner,
				...(id ? { id, expected_metadata: expected } : {}),
				name: i.fields.getTextInputValue("name"),
				...(!group ? { repo: i.fields.getTextInputValue("repo"), description: i.fields.getTextInputValue("description") } : {}),
			};
			const saved = await this.repo.operation(group ? "manage-group" : "manage-label", payload);
			const [labels, groups] = await Promise.all([this.repo.labels(i.guildId!), this.repo.groups(i.guildId!)]);
			await i.editReply(renderManagement(labels, groups, owner, group ? "group" : "label", saved.id));
		} catch {
			await i.editReply({
				content: "Management change could not be completed. The item may have changed or its name may already exist; reopen /todo manage and try again.",
				allowedMentions: mentions,
			});
		}
	}
}
