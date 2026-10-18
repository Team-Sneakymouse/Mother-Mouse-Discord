# Release checklist

Use `/release title:Weekly release` to post an empty checklist in the current channel. Creation defaults to server administrators; Discord's command permissions can override that default. Anyone with access to the message can manage the checklist.

- **Add feature** opens a modal. New features start yellow and unready.
- **Mark ready / Mark unready** updates the feature's status and emoji on the same card.
- **Manage release** opens a private panel for renaming the release, editing or removing features, and archiving or reopening the release. Removal is immediate.
- Management actions refresh that private panel with the updated title, feature choices and archive controls.
- Active cards turn green when at least one feature is present and all features are ready; empty or incomplete cards are yellow. Archived cards are gray.
- Archived cards retain all features and statuses. Reopen them to make changes, even if all features were already ready when archived.

The Discord message is the persistent store: names live in text components, while versioned button custom IDs hold feature identities, readiness and archive state. Interactions use a global handler, so existing cards work after bot restarts. Deleting the message deletes the checklist. There is no database or deployment automation.

Cards support up to 11 features within Discord's 40-component limit. A further addition returns an error and preserves the existing card. Titles and feature names are limited to 120 characters on one line. Pagination is out of scope.

Public-card interactions use the message snapshot included by Discord. Ready clicks and add submissions update that card in a single interaction response, without a fetch or deferred acknowledgement. There is no update queue or separate release-state cache; overlapping actions can overwrite one another, an accepted tradeoff for this small checklist. A modal opened before another change may also submit an older snapshot.

Management interactions originate on the private panel, so they retrieve the separate public card through discord.js's message manager. It uses a complete cached message when available and fetches from Discord on a cache miss or partial message (for example, after a restart). Mutations overlap acknowledgement with that lookup, then save the card and refresh the private panel. This relies on the single bot instance receiving message updates; caching does not provide concurrency protection.

The command is registered globally in `registerCommands.ts`, and the handler is enabled with the other production plugins in `src/bot.ts`. Run `bun registerCommands.ts` as part of the usual command registration workflow before using the command.
