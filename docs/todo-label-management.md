# Label and group management

Run `/todo manage` in RAWBTV to open an ephemeral management screen. It uses the same default-administrator command registration and Discord server command-permission overrides as the other todo commands. Only the invoking developer can use its controls. No management message is posted publicly.

- **Labels**: browse every label, create a label, or select one and edit its exact name, repository and description in a modal. An empty repository/description is permitted; no repository is guessed or fetched. Existing `thread_id` values are preserved.
- **Groups**: create/edit the group name; select a Discord user to assign the group, or clear that assignment. A user can own several groups. Groups do not need an assigned user.
- **Membership**: link/unlink one label or nested group at a time. All pickers paginate at 25 items, including the catalog of 37 labels. Operations preserve members on other pages and shared labels may belong to several groups. Group cycles and cross-server relations are rejected transactionally by trusted PocketBase hooks.
- There is no destructive delete control. Management does not rewrite todo history or relabel existing todos.
- Metadata-edit modals carry a restart-safe optimistic fingerprint. If another editor changes the same metadata before submission, the transaction rejects the stale edit rather than overwriting it; reopen `/todo manage` to review the latest values. Group assignment and individual membership changes preserve unrelated changes.
- Discord text-input modals accept at most 4,000 description characters. Existing longer descriptions are previewed but cannot be edited through the modal: the UI explicitly refuses to truncate them; use the trusted management API instead.

`/todo list label:me` unions the labels in **all** groups assigned to the actual invoking Discord user, recursively including nested groups. It combines with `kind` and `priority` using AND. No assignment (or only empty assigned groups) means no results, never all results. Refresh, pagination and returning from an item retain the filter and rebind it to the actual invoker. Autocomplete uses the exact special value `me`; concrete labels still use `label:<record-id>` and groups use `group:<record-id>`.

## Schema addition (review before applying)

`pocketbase/todo.group-assignment-field.json` is the field-only artifact:

```json
{"name":"assigned_user_id","type":"text","required":false,"max":20}
```

Add this optional field to `todo_list_label_groups`, retaining every existing field, relation, index and private rule. Do not replace the live collection using this field-only JSON. The trusted hook validates that nonempty values contain only Discord snowflake digits. The complete schema for fresh isolated installations is `pocketbase/todo.collections.json`.

## Reviewed catalog seed

`pocketbase/todo.catalog.seed.json` contains the exact 37 supplied objects (`name`, `url`, `explanation`) and seven named groups. Input nulls are retained in the artifact and explicitly stored as empty PocketBase text fields. No repository is discovered automatically. `Paper plugins` literally excludes Configuration, MagicSpells scripting, Navigation, Resourcepack and SneakyResourcePacks, and therefore includes Mother Mouse Discord. Velocity currently contains only SneakyCharacterManager. Momo includes Oakley/Bungo as child groups; Bungo's confirmed cellphone member is the existing exact label `SneakyCellPhones`.

After reviewing the optional field migration and deploying the trusted hooks, an authorized operator can submit the artifact to `POST /api/shared-todo/seed-catalog`, adding an explicit `actor` Discord user ID. For example (this is a live write, **not** a preview):

```sh
jq --arg actor "$DISCORD_USER_ID" '. + {actor:$actor}' pocketbase/todo.catalog.seed.json |
  curl --fail-with-body --request POST "$POCKETBASE_URL/api/shared-todo/seed-catalog" \
    --header "Authorization: $POCKETBASE_TOKEN" --header 'Content-Type: application/json' --data-binary @-
```

The route requires superuser authentication and runs the entire seed in one transaction. It creates missing exact-name labels/groups only. Existing matching records are a no-op; conflicting repository, description, ownership or membership aborts the whole request without overwriting anything. Existing unrelated records and label `thread_id` values are left alone. Group membership comparisons are order-independent. The response includes `created_labels`, `created_groups`, and exact name-to-record-ID maps for read-back verification. Re-read the exact target records after an operator submits a live seed; an HTTP success is not sufficient verification.

The same protected transactional route offers `manage-label` and `manage-group` for the graphical UI. Both require `guild_id` and `actor`; an optional `id` edits an existing same-server record, otherwise a new record is created. Supplied metadata fields are updated explicitly and unspecified fields are preserved. API callers can protect metadata edits with `expected_metadata`: the first 32 lowercase hex characters of SHA-256 over UTF-8 `JSON.stringify([name,repo,description])` for a label (empty strings for missing text), or `JSON.stringify([name])` for a group, using the last-read values. The UI supplies this automatically and rejects legacy edit modals without it. Group membership can use `{membership:{field:"labels"|"child_groups",operation:"link"|"unlink",id:"record-id"}}`; it changes only that one reference against the current transactional state.

## Verification

`tests/TodoCatalogSeed.test.ts` pins the original supplied label metadata by canonical SHA-256 and checks groups/schema. `tests/TodoManagement.test.ts` exercises the owner-bound UI, pagination, modals and membership/user callbacks. `tests/TodoPocketBase.test.ts` runs the real hook routes against a disposable local PocketBase database when `TODO_PB_BINARY` is set, including idempotency, conflict rollback, ownership, group cycles and foreign-server rejection. These tests never target the configured live PocketBase URL. A live Discord click-through remains an operator verification step after command registration and deployment.
