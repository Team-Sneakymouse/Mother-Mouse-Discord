# Account management

`/accounts` (and its aliases) and `/link` let members link Minecraft accounts and a Twitch account to their Discord
account. The data lives in PostgreSQL, in SneakyUserMeta's schema `sneakyusermeta`
([Team-Sneakymouse/SneakyUserMeta](https://github.com/Team-Sneakymouse/SneakyUserMeta)). The bot never writes those
tables: every change goes through SneakyUserMeta's linking functions, which Minecraft (`/link` in game) and the shop's
"Minecraft accounts" page call too, so all three follow the same rules. See SneakyUserMeta's README, "Linking".

- Runs in production only, and only when `PGHOST`, `PGUSER`, `PGPASSWORD` and `PGDATABASE` are set (the same
  connection as push tracking). The role needs `EXECUTE` on the linking functions and `SELECT` on
  `sneakyusermeta.users`, `accounts` and `twitch_accounts`; the role that owns them (SneakyDB's) has both.
- Link tokens have five digits and work for 30 minutes. Asking again shows the same token. Five wrong tokens within
  ten minutes block a member's attempts for a while (per bot process).
- The first linked Minecraft account becomes main. Unlinking the main account makes the member's most recently seen
  other account main.
- Twitch uses the OAuth flow at `/link/twitch` (`TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_REDIRECT_URI`).
  The tokens go to `sneakyusermeta.twitch_tokens`. Linking a Twitch account that another member had linked moves it.

## Tests

`tests/AccountStore.test.ts` applies SneakyUserMeta's migration scripts to a disposable database:

```bash
ACCOUNTS_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:15432/postgres \
SNEAKYUSERMETA_MIGRATIONS=../SneakyUserMeta/src/main/resources/db/migrations bun test tests/AccountStore.test.ts
```
