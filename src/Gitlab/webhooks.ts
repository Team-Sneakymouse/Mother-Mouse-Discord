import {
	ButtonComponentData,
	ButtonStyle,
	Client,
	ComponentType,
	Embed,
	Message,
	MessageAttachment,
	TextChannel,
	Util,
} from "discord.js";
import { Redis } from "ioredis";
import { Request, Response } from "express";
import { channelIds, projectIds, Projects, webhooks } from "./utils";
import { Gitlab } from "@gitbeaker/node";
import axios from "axios";
import { Stream } from "node:stream";

export default function init(client: Client, redis: Redis, gitlab: InstanceType<typeof Gitlab>) {
	return async function (req: Request, res: Response) {
		let issueMessage: Message | undefined = undefined;
		let project: Projects | undefined = undefined;
		const id = req.body.event_type === "issue" ? req.body.object_attributes.id : req.body.issue.id;
		const messageIds = await redis.get(`mm-discord-gitlab:issue-${id}`);
		if (messageIds) {
			const [guildId, channelId, messageId] = messageIds.split("-") as [Projects, string, string];
			project = guildId;

			const channel = client.channels.cache.get(channelId) as TextChannel | undefined;
			try {
				const message = await channel?.messages.fetch(messageId);
				if (message && message instanceof Message) issueMessage = message;
			} catch (e) {
				console.error(e);
			}
		} else {
			project = (Object.entries(projectIds) as [Projects, number][]).find(([k, v]) => v == req.body.project.id)?.[0];
			if (!project) {
				console.error(`Guild not found for project ${req.body.project.id}`);
				return res.status(200).send(`Guild not found for project ${req.body.project.id}`);
			}
		}
		const botUser = req.body.object_attributes.author_id === 10763862;
		const project_id = req.body.project.id;

		if (req.body.event_type === "issue") {
			let author: any;
			if (!botUser && req.body.object_attributes.author_id !== req.body.user.id)
				author = await gitlab.Users.show(req.body.object_attributes.author_id);
			const authorImage = botUser
				? req.body.object_attributes.description.match(/\[Profile Image\]\(([^?)]+)[^)]*\)/)?.[1]
				: author.avatar_url;
			const authorName = botUser ? req.body.object_attributes.description.match(/\*\*([^\*]+)\*\*/)?.[1] : author.name;
			const authorUrl = botUser
				? `https://discord.com/users/${authorImage?.match(/avatars\/(\d+)/)?.[1]}`
				: `https://gitlab.com/${author.username}`;

			const created_at = req.body.object_attributes.created_at;
			const description =
				(req.body.object_attributes.description.split("\n---\n")[1] || req.body.object_attributes.description).replaceAll(
					/!?\[([^\]]+)\]\(\/([^\)]+)\)/g,
					`[$1](${req.body.project.web_url}/$2)`
				) || "";
			const id = req.body.object_attributes.id;
			const iid = req.body.object_attributes.iid;
			const title = req.body.object_attributes.title;
			const url = req.body.object_attributes.url;
			const state = req.body.object_attributes.state as "opened" | "closed";
			const action = req.body.object_attributes.action as "open" | "close" | "update" | "reopen";

			const embed = new Embed({
				author: {
					name: authorName,
					icon_url: authorImage,
					url: authorUrl,
				},
				title: title,
				url: url,
				description: description,
				color: state === "opened" ? Util.resolveColor("#2DA160") : Util.resolveColor("#428FDC"),
				timestamp: new Date(created_at).toISOString(),
				footer: {
					text: "Issue #" + iid,
					icon_url: "https://files.sneakyrp.com/gitlab.png",
				},
			});
			const buttons: ButtonComponentData[] = [
				{
					type: ComponentType.Button,
					label: "Edit",
					customId: `issue-edit_${iid}`,
					style: state === "opened" ? ButtonStyle.Primary : ButtonStyle.Secondary,
				},
				{
					type: ComponentType.Button,
					label: state === "opened" ? "Close" : "Reopen",
					customId: `issue-${state === "opened" ? "close" : "open"}_${iid}`,
					style: state === "opened" ? ButtonStyle.Success : ButtonStyle.Danger,
				},
			];
			const urls = (description as string).match(/https?:\/\/[^\s]+/gi) || [];
			const streamPromises = urls.map((url) => axios.get(url, { responseType: "stream" }).then((res) => [res.data, url]));
			const streams = await Promise.all(streamPromises);
			const attachments = streams.map(
				([stream, url]) => new MessageAttachment(stream as Stream, (url as string).split("/").pop())
			);

			if (!issueMessage) {
				// Post new message
				const channelId = channelIds[project];
				console.log(`Posting new issue message for project ${project} in channel ${channelId}`);
				const channel = (client.channels.cache.get(channelId) || (await client.channels.fetch(channelId))) as TextChannel;
				issueMessage = await channel.send({
					content: "\u00A0",
					embeds: [embed],
					components: [
						{
							type: ComponentType.ActionRow,
							components: [...buttons],
						},
					],
					files: attachments,
				});
				await redis.set(`mm-discord-gitlab:issue-${id}`, `${project}-${channelId}-${issueMessage.id}`);
				res.status(200).send();
				await startThread(issueMessage, title, project_id, iid);
			} else {
				// Update existing message
				await issueMessage.edit({
					content: "\u00A0",
					embeds: [embed],
					components: [
						{
							type: ComponentType.ActionRow,
							components: [...buttons],
						},
					],
					files: attachments,
				});
				res.status(200).send();
				const thread = issueMessage.thread || (await startThread(issueMessage, title, project_id, iid));
				if (thread.name.substring(0, 99) !== title.substring(0, 99)) await thread.setName(title);
				if (state === "closed" && !thread.archived) await thread.setArchived(true);
				else if (state === "opened" && thread.archived) await thread.setArchived(false);
			}
		} else if (req.body.event_type === "note" && !botUser) {
			if (!issueMessage?.thread?.id) {
				console.error(`Issue message not found for note ${req.body.object_attributes.id}`);
				return res.status(200).send(`Issue message not found for note ${req.body.object_attributes.id}`);
			}
			const webhook = await client.fetchWebhook(...webhooks[project]);
			await webhook.send({
				threadId: issueMessage?.thread?.id,
				username: !botUser ? req.body.user.name : req.body.object_attributes.note.match(/\*\*([^\*]+)\*\*/)?.[1],
				avatarURL: !botUser
					? req.body.user.avatar_url
					: req.body.object_attributes.note.match(/\[Profile Image\]\(([^?)]+)[^)]*\)/)?.[1],
				content: (req.body.object_attributes.note.split("\n---\n")[1] || req.body.object_attributes.note).replaceAll(
					/!?\[[^\]+]\]\(\/([^\)]+)\)/g,
					req.body.project.web_url + "/$1"
				),
			});

			res.status(200).send();
		}
	};

	async function startThread(message: Message, title: string, projectId: number, issueId: number) {
		// title = `#${issueId} ${title}`;
		title = title.length >= 100 ? title.substring(0, 99) + "\u2026" : title;
		const thread = await message.startThread({
			name: title,
			autoArchiveDuration: "MAX",
		});
		const project = await gitlab.Projects.show(projectId);
		const comments = await gitlab.IssueNotes.all(projectId, issueId, { sort: "asc" });
		const webhook = await client.fetchWebhook(...webhooks[message.guildId as Projects]);

		for (const comment of comments) {
			const botUser = comment.author.id === 10763862;

			if (!comment.system) {
				await webhook.send({
					threadId: thread.id,
					username: !botUser
						? comment.author.username
						: comment.body.match(/\*\*([^\*]+)\*\*/)?.[1] || comment.author.username,
					avatarURL: comment.body.match(/\[Profile Image\]\(([^?)]+)[^)]*\)/)?.[1] || comment.author.avatar_url,
					content: (comment.body.split("\n---\n")[1] || comment.body).replaceAll(
						/!?\[([^\]]+)\]\(\/([^\)]+)\)/g,
						`[$1](${project.web_url}/$2)`
					),
				});
			} else {
				await thread.send({
					content: "\u00A0",
					embeds: [
						{
							author: {
								name: comment.author.username,
								iconURL: comment.author.avatar_url,
							},
							description: comment.body,
						},
					],
				});
			}
		}
		return thread;
	}
}
