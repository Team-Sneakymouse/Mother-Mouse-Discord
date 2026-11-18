# Reward mail

ReactionRewards (Rawb's red gem) and LeaderboardRewards (daily leaderboard places) send in-game mail through
SneakyMail's PostgreSQL function `sneakymail.send` ([Team-Sneakymouse/SneakyMail](https://github.com/Team-Sneakymouse/SneakyMail),
`db/migrations/V001`). The bot never writes the `sneakymail.mail` table itself. `mailSenderFromEnv()` in
`src/utils/SneakyMail.ts` gives both features the same sender on the bot's PostgreSQL connection (null without
`PGHOST`; then no mail is sent and the features log why).

- The role needs `EXECUTE` on `sneakymail.send`; the role that owns SneakyMail's objects has it.
- Rewards are console commands, `[{"type":"command","command":"ms cast as {player} <spell>"}]`, sent to the
  Minecraft account's UUID. Mail does not expire.

## Source keys

Every mail carries a source key. Sending the same key and content again returns the mail already sent, so a retry
can't reward twice. The same key with different content fails (SQLSTATE `23505`, `SourceKeyReusedError`); that
mail is not sent and the error is logged.

| Feature | Key | One mail per |
|---|---|---|
| ReactionRewards | `reaction:red-gem:<Discord message id>` | message Rawb reacted to |
| LeaderboardRewards | `leaderboard:<leaderboard>:<yyyy-mm-dd>:<account UUID>` | account, leaderboard and game day; holds every reward it earned there |

The leaderboard key leaves out the rank: it depends on the other players' scores, so a retry that saw one more score
would otherwise send a second mail. The day is the one the scores are stored under in `lom2_leaderboards`.

## Tests

`tests/fakeSneakyMail.ts` stands in for PostgreSQL behind `PostgresMailSender` and keeps `sneakymail.send`'s
source-key rules. `tests/SneakyMail.test.ts` checks the call itself; the feature tests use the fake.
