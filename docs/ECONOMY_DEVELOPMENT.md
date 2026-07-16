# Mountain economy development guide

This document records the assumptions that must remain true as Mountain evolves.

## Architecture map

- `src/lib/server/db/accounts.ts`: balances, transfers, mint/burn, ranking, supply, and ledger reads.
- `src/lib/server/economy/money.ts`: canonical money parsing and integer-cent conversion.
- `src/lib/server/db/guild-settings.ts`: per-server unit, visibility, and notification settings.
- `src/lib/server/bot/commands/`: Discord slash command definitions and handlers.
- `src/lib/server/bot/notifications.ts`: best-effort Discord transaction notifications.
- `src/routes/+page.server.ts`: authenticated user dashboard data and web transfers.
- `src/routes/admin/+page.server.ts`: manage-guild settings, mint, and burn actions.
- `database.sql`: manual database provisioning reference.
- `src/lib/server/db.ts`: runtime schema bootstrap and repair statements.

## Server-scoped economy

Accounts are identified by `(guild_id, user_id)`, not by a Discord user alone. The same user may
have unrelated balances in different servers. Never query or mutate an account using only
`user_id`. The selected web dashboard guild must also be verified against the authenticated
user's stored guild memberships.

Guild settings are similarly scoped by `guild_id`. The current settings are the currency unit,
public balance lookup, public ranking, and the transaction notification channel.

## Money rules

- Database type: `DECIMAL(15, 2)`.
- Minimum positive unit: `0.01`.
- Accepted input: a non-negative decimal string with no more than two fractional digits.
- External input must go through `parseMoney`.
- Arithmetic must use `moneyToCents`, `centsToMoney`, and `bigint`.
- Do not convert monetary values to JavaScript `number` for calculations.

Formatting a database value for display is acceptable, but calculations and comparisons must
remain exact.

## Ledger rules

The `transactions` table is the source of transaction history. Every successful balance mutation
must insert exactly one row in the same database transaction as its balance update.

| Operation | `sender_id`  | `recipient_id` | `transaction_type` |
| --------- | ------------ | -------------- | ------------------ |
| Transfer  | sender       | recipient      | `transfer`         |
| Mint      | `NULL`       | credited user  | `mint`             |
| Burn      | debited user | `NULL`         | `burn`             |

Use row locks for debit operations. A failed insufficient-balance check must change neither the
balance nor the ledger. Discord notifications are sent after commit and intentionally swallow
delivery failures so an external Discord error cannot invalidate completed money movement.

Personal history may include rows where the current user is sender or recipient. A future
server-wide audit page must be administrator-only and enforce manage-guild permission on the
server, not only in the UI.

## Database schema changes

For every schema change:

1. Update the canonical `CREATE TABLE` statement in `database.sql`.
2. Update `TABLES` in `src/lib/server/db.ts` for fresh installations.
3. Add an idempotent statement to `REPAIRS` for existing installations.
4. Apply or verify the migration against the configured MariaDB instance.
5. Run application checks and a production build.

The MariaDB user needs schema-change permissions when automatic repairs are expected to run.

## Discord command changes

Commands live under `src/lib/server/bot/commands` and must be added to the command map in
`src/lib/server/bot/index.ts`. User-visible command names and descriptions support English,
Korean, and Japanese.

After adding, renaming, or deleting a command, re-register the complete list with Discord. In a
configured development environment this can be done once with:

```bash
bun -e "import { reloadCommands } from './src/lib/server/bot/index.ts'; await reloadCommands();"
```

Do not leave multiple bot processes running with the same token. `Ctrl+C` and deployment shutdown
must preserve the graceful signal handler so the Discord and database connections close cleanly.

## Authorization checklist

- Ordinary dashboard actions require an authenticated session and membership in the selected
  guild.
- Admin actions require manage-guild permission.
- Transfer recipients and mint/burn targets must be verified as current, non-bot guild members.
- Self-transfer remains forbidden. Admin mint/burn search may include the administrator.
- Never trust guild IDs, user IDs, amounts, or permissions submitted by the browser without
  server-side validation.

## Completion checklist

Before handing off any implementation:

```bash
bun run check
bun run build
git diff --check
git status --short
```

Review the diff, stage only task-related files, and create a Git commit. Do not amend or fold in
unrelated user work. Report what changed, what was verified, and the resulting commit hash.
