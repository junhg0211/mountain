# Mountain economy development guide

This document records the assumptions that must remain true as Mountain evolves.

## Architecture map

- `src/lib/server/db/accounts.ts`: balances, transfers, mint/burn, ranking, supply, and ledger reads.
- `src/lib/server/db/betting.ts`: betting pool escrow, staking, settlement, refund, and live views.
- `src/lib/server/db/attendance.ts`: Korean-date daily claims and atomic reward payments.
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

| Operation  | `sender_id`  | `recipient_id` | `transaction_type` |
| ---------- | ------------ | -------------- | ------------------ |
| Transfer   | sender       | recipient      | `transfer`         |
| Mint       | `NULL`       | credited user  | `mint`             |
| Burn       | debited user | `NULL`         | `burn`             |
| Bet stake  | participant  | `NULL`         | `bet_stake`        |
| Bet payout | `NULL`       | winner         | `bet_payout`       |
| Bet refund | `NULL`       | participant    | `bet_refund`       |
| Attendance | `NULL`       | rewarded user  | `attendance`       |

Betting rows also carry `betting_pool_id`. Money staked in an open pool is escrow, not burned, so
total supply is account balances plus stakes in open pools. Settlement and refund must lock the
pool row first; only an `open` pool can move money. The host may settle or refund, and a user with
manage-guild permission may override for recovery. Settlement requires the winner to be a current
participant. Refund restores every participant's cumulative stake exactly once.

The betting web UI lives at `/bets` with one `/bets/[poolId]` detail page per pool. Quick betting
accepts only `0.01`, `0.05`, `0.10`, `0.50`, `1.00`, `5.00`, `10.00`, `50.00`, `100.00`, and
`500.00`; the action validates this allowlist on the server. Clients obtain a 30-second,
single-use ticket after session and guild membership checks, then connect to `/ws/betting`.
WebSockets carry invalidation events only; the client reloads the pool through the authorized HTTP
API. Publish an update after committed web or Discord create, stake, settle, and refund operations.
Production must start with `bun run start`/`server.ts`, not `build/index.js` directly, so WebSocket
upgrades are handled.

Betting pool owners, winners, and participants must be displayed using their current guild nickname
when available, then Discord global display name, then username. Keep the database username only as
a fallback when Discord member lookup is unavailable.

New pools use `betting_mode='team'` with options `A` and `B`; old pools remain `legacy`. A user may
add stakes only to the first team they selected. Team settlement divides the complete escrow pot by
each winning user's integer-cent share of the winning team's stake. Floor each payout first, then
assign remaining cents in stable user-id order so payout ledger rows sum exactly to the pot. Reject
settlement when the selected team has no stake. Store create, stake, settle, and refund activity in
`betting_events` inside the same database transaction as the associated monetary operation.

The pool detail response includes A/B totals, event feed, and authenticated-user statistics. The UI
computes button-level estimated gross payout from the current pot, the selected team's total, the
user's existing same-team stake, and the proposed additional stake using integer cents. Estimates
are informational and the committed settlement remains authoritative.

Attendance rewards are configured per guild. `0.00` disables attendance; a positive reward must
be at least `0.01`. Claims use the `Asia/Seoul` calendar date and the composite primary key
`(guild_id, user_id, attendance_date)`. Inserting the claim, crediting the account, and writing the
`attendance` ledger row must happen in one database transaction. This prevents duplicate rewards
when web and Discord claims race each other.

`attendance_streaks` stores the current streak, longest streak, and last attendance date per guild
and user. A claim on the Korean calendar day immediately following the last claim increments the
current streak; otherwise it resets to one. The longest streak never decreases. Streak updates are
part of the claim transaction. If a streak row is missing for an existing user, rebuild it from
`attendance_claims` before saving. Leaderboards rank longest streak first and current streak second.
Display the current streak as zero after a missed Korean calendar day, while preserving the stored
longest streak. Read SQL `DATE` values with `DATE_FORMAT(..., '%Y-%m-%d')` to avoid driver timezone
shifts.

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
