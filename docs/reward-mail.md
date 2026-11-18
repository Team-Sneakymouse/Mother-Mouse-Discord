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

## Failed sends

A send that fails on connection trouble or a serialization failure (SQLSTATE class `08`, `40001`, `40P01`, `57P01`
to `57P03`, `53300`, and Bun's connection, timeout and refused errors) is tried again after 1 s and after 5 s. The
source key makes that safe. A reused key (`23505`), bad data (such as `22P02`) or a missing `sneakymail.send`
(`42883`) fail at once.

Every failure log line names the source key. A failure after the retries may still have committed (the reply was
lost), so the line says the mail is not confirmed and ends with
`Resend by hand (safe, same key): select sneakymail.send('<logged key>', ...)`: run that statement in DBeaver or psql as it stands,
once the database is back. It has the same key and content, so if the failed send did commit after all, it
returns that mail's id instead of sending a second one. A line saying the key "already names a mail with different
content" means the account already has mail under that key: check it in `sneakymail.mail` before sending anything.

## Tests

`tests/fakeSneakyMail.ts` stands in for PostgreSQL behind `PostgresMailSender` and keeps `sneakymail.send`'s
source-key rules. `tests/SneakyMail.test.ts` checks the call itself; the feature tests use the fake.
