# Release checklist

Use `/release title:Weekly release` to post an empty checklist in the current channel. Creation defaults to server administrators; Discord's command permissions can override that default. Anyone with access to the message can manage the checklist.

- **Add feature** opens a modal. New features start yellow and unready.
- **Mark ready / Mark unready** updates the feature's status and emoji on the same card.
- **Manage release** opens a private panel for renaming the release, editing or removing features, and archiving or reopening the release. Removal is immediate.
- Archived cards retain all features and statuses. Reopen them to make changes, even if all features were already ready when archived.

The Discord message is the persistent store: names live in text components, while versioned button custom IDs hold feature identities, readiness and archive state. Interactions use a global handler, so existing cards work after bot restarts. Deleting the message deletes the checklist. There is no database or deployment automation.

Cards support up to 11 features within Discord's 40-component limit. A further addition returns an error and preserves the existing card. Titles and feature names are limited to 120 characters on one line. Pagination is out of scope.

Updates are serialized per message, with a fresh fetch before every change. This assumes a single bot process; running multiple bot instances would require coordination between them.

The command is registered globally in `registerCommands.ts`, and the handler is enabled with the other production plugins in `src/bot.ts`. Run `bun registerCommands.ts` as part of the usual command registration workflow before using the command.
