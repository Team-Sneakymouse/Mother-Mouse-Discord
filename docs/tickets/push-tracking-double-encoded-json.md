# Push tracking stores `jsonb` columns double-encoded

**Area:** `src/PushTracking/postgres.ts` (schema `discord_push_tracking`)
**Found:** 2026-11-07, while building SneakyPipeMonitor, which reads these tables
**Severity:** low for the bot (its reads cope), but it breaks every other reader and SQL on the JSON

## Problem

`pushes.commits` and `stages.detail` should hold a JSON array and object. Instead each holds a JSON *string* whose
text is the array or object:

```text
stages.detail   "{\"name\":\"Build and publish\",\"url\":\"…\",\"attempt\":1,\"run\":41909247279}"   ← jsonb string
expected        {"name": "Build and publish", "url": "…", "attempt": 1, "run": 41909247279}         ← jsonb object
```

Every row is affected (2026-11-07):

| Column | `jsonb_typeof` | Rows |
|---|---|---|
| `stages.detail` | `string` | 2192 |
| `pushes.commits` | `string` | 1259 |
| `pushes.commits` | `NULL` | 8 |

## Cause

Both writes bind an already serialized string and cast it to `jsonb`:

```ts
const commits = details.commits ? JSON.stringify(details.commits) : null;
… ${commits}::jsonb …                                    // upsertPush, line ~150
… ${JSON.stringify(stage.detail)}::jsonb …               // setStage, line ~186
```

Bun's SQL client serializes the bound value as JSON for the `jsonb` parameter, so the string is encoded a second time.
The bot doesn't notice because it reads through `json()` (`typeof value === "string" ? JSON.parse(value) : value`),
which parses the extra layer away. `tests/PushTrackingStore.test.ts` reads back through the same store, so it passes.

## Impact

- SQL can't look inside the values: `detail->>'name'` and `commits->-1->>'subject'` are always `NULL`.
- Other readers get a string where they expect an object or array. SneakyPipeMonitor showed no commit subjects,
  could not match workflows by name, and labelled failures "failed: CI". It now unwraps string values in SQL
  (`case when jsonb_typeof(x) = 'string' then (x #>> '{}')::jsonb else x end`), so it works with both forms.

## Fix

1. **Write real JSON.** Bind the object or array itself (`${stage.detail}::jsonb`, `${details.commits ?? null}::jsonb`)
   or whatever Bun SQL's documented way of passing JSON is. Check the stored type rather than assuming it.
2. **Convert existing rows** in a new migration (append to `MIGRATIONS`; never edit migration 1):

   ```sql
   update discord_push_tracking.stages set detail = (detail #>> '{}')::jsonb where jsonb_typeof(detail) = 'string';
   update discord_push_tracking.pushes set commits = (commits #>> '{}')::jsonb where jsonb_typeof(commits) = 'string';
   ```

   The `commits` update changes no `version`, so `pushes_notify` stays quiet and no Discord message is re-rendered.
   It rewrites ~3,500 small rows inside the migration's transaction.
3. **Keep `json()`** for now. It accepts both forms, so the order of deploy and migration doesn't matter.
4. **Test the stored form:** in `PushTrackingStore.test.ts`, assert `jsonb_typeof(detail) = 'object'` and
   `jsonb_typeof(commits) = 'array'` straight from SQL, not through the store.

## Done when

- `select jsonb_typeof(detail), count(*) from discord_push_tracking.stages group by 1` shows only `object`, and
  `pushes.commits` only `array` (or `NULL`).
- New pushes and stages keep that form.
- The bot's Discord messages render as before.
