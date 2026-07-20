# Mountain economy development guide

This document records the assumptions that must remain true as Mountain evolves.

## Architecture map

- `src/lib/server/db/accounts.ts`: balances, transfers, mint/burn, ranking, supply, and ledger reads.
- `src/lib/server/db/betting.ts`: betting pool escrow, staking, settlement, refund, and live views.
- `src/lib/server/db/attendance.ts`: Korean-date daily claims and atomic reward payments.
- `src/lib/server/db/voice-activity.ts`: bucketed voice rewards and per-user daily caps.
- `src/lib/server/db/monthly-burn.ts`: idempotent scheduled percentage burns and ledger writes.
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
public balance lookup, public ranking, reward configuration, monthly burn schedule, and the
transaction notification channel.

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

| Operation      | `sender_id`  | `recipient_id` | `transaction_type` |
| -------------- | ------------ | -------------- | ------------------ |
| Transfer       | sender       | recipient      | `transfer`         |
| Mint           | `NULL`       | credited user  | `mint`             |
| Burn           | debited user | `NULL`         | `burn`             |
| Bet stake      | participant  | `NULL`         | `bet_stake`        |
| Bet payout     | `NULL`       | winner         | `bet_payout`       |
| Bet refund     | `NULL`       | participant    | `bet_refund`       |
| Table funding  | owner        | `NULL`         | `bet_fund`         |
| House fallback | owner        | `NULL`         | `bet_house_cover`  |
| House return   | `NULL`       | owner          | `bet_house_refund` |
| Weighted settle| losing user  | winning user   | `bet_weighted`     |
| Attendance     | `NULL`       | rewarded user  | `attendance`       |
| Voice activity | `NULL`       | rewarded user  | `voice_activity`   |
| Monthly burn   | debited user | `NULL`         | `monthly_burn`     |
| Role renewal   | subscriber   | `NULL`         | `role_subscription` |
| Scheduled pay  | sender       | recipient      | `scheduled_transfer` |

Signed weighted settlement is owner-only and uses an integer weight for every pool member. The
service centers all weights around their arithmetic mean, treating that mean as zero, so the raw
weights do not need to sum to zero or contain negative values. It calculates each result as
`(weight - mean) * unit amount`, rounds the total pot down to cents, and distributes leftover cents
by fractional remainder and then user ID so credits and debits remain exactly equal and deterministic.
It refunds any current stakes first, locks participant accounts in stable user-ID order, verifies
all below-average balances, and transfers their debits to above-average participants. Each paired
movement writes a `bet_weighted` ledger row, while
`betting_weighted_results` preserves the complete per-user result for the settlement event. Any
validation or balance failure rolls back the refunds and the entire settlement together.

## Automatic payments and role subscriptions

`scheduled_transfers` stores only same-guild transfers. Creation does not debit the sender. The
scheduler executes at the displayed KST time, locks both accounts, and writes the balance movement
and `scheduled_transfer` ledger row in one transaction. A unique `automatic_payment_runs` key makes
each scheduled occurrence idempotent. Insufficient balance records a failed run, advances to the
next occurrence, and keeps the instruction active. If the recipient leaves the guild, cancel it.

Role products refer to existing Discord roles; Mountain never creates a role. Signup charges the
full monthly price immediately, then renews on the first day of each month at 12:00 KST. There is no
proration or refund, and both web and Discord surfaces must display that warning before signup.
Insufficient renewal balance cancels the subscription and removes the role. A missing, managed, or
disabled role product cancels its active subscriptions. Discord role changes happen outside the
database transaction and failures must never leave an unrecorded balance mutation.

## Reusable betting pools

Betting settlement and permanent closure are separate operations. After a pool is settled or
refunded, reopening copies all entrants into `betting_pool_members`, deletes only the previous
round's `betting_entries`, and resets the pool to `open`. Roster members remain visible with a zero
current stake and can choose a team again. Never carry a prior round's stake into a new round.

Permanent closure uses `status='archived'`, which normal web and Discord list queries omit.
Archiving an open pool first refunds every current entry and records each `bet_refund` in the same
database transaction, then archives the pool. Only the owner or a manage-guild administrator may
reopen or archive it.

`betting_pools.house_balance` is reusable table escrow for blackjack/baccarat-style payouts. Only
the pool owner may fund it, individually refund a current entry, pay an entry at 2x, or permanently
archive the pool. A 2x payout returns the participant's stake plus equal winnings. Consume winnings
from `house_balance` first; if it is short, lock and debit only the shortage from the owner's guild
account using `bet_house_cover`. The payout, cover, entry deletion, and balances belong to one DB
transaction. Archiving refunds open entries and returns all remaining house escrow to the owner.
Manage-guild permission must never override permanent archive ownership, and non-owners must not be
shown its button.

Betting rows also carry `betting_pool_id`. Money staked in an open pool is escrow, not burned, so
total supply is account balances plus stakes in open pools. Settlement and refund must lock the
pool row first; only an `open` pool can move money. The host may settle or refund, and a user with
manage-guild permission may override for recovery. Settlement requires the winner to be a current
participant. Refund restores every participant's cumulative stake exactly once.

The betting web UI lives at `/bets` with one `/bets/[poolId]` detail page per pool. Quick betting
accepts only `0.01`, `0.05`, `0.10`, `0.50`, `1.00`, `5.00`, `10.00`, `50.00`, `100.00`, and
`500.00`; the action validates this allowlist on the server. Clients obtain a 30-second,
single-use ticket after session and guild membership checks, then connect to `/ws/betting`. The
ticket binds both `guild_id` and `user_id`; every incoming bet message must re-check stored guild
access and current Discord membership. Quick-bet buttons send `place-bet` over that socket and the
server responds with `bet-result` containing the committed balance, pool, events, and user stats so
the initiating client does not issue a POST or reload. Pool creation uses `create-pool`, and every
state-changing detail action (settlement, full or individual refund, funding, double payout,
weighted settlement, reopening, and archive) uses `dashboard-action`. The server must re-check
membership and the required owner/manage-guild permission for every message, execute the existing
atomic database service, and respond with `create-result` or `action-result`. Other clients receive
an invalidation event and refresh through the authorized HTTP API. Publish and send best-effort
Discord notifications only after the money transaction commits, even if the initiating socket has
already disconnected.

Transaction-channel notifications are rendered as a single horizontal line. Callers may compose
readable multiline templates, but `sendTransactionNotification` trims each line and joins them with
` · ` before sending so logs do not grow vertically in Discord.

Production must start with `bun run start`/`server.ts`, not `build/index.js` directly, so WebSocket
upgrades are handled and the Discord bot starts immediately without waiting for an HTTP request.

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

At midnight in `Asia/Seoul`, each guild with attendance enabled and a transaction notification
channel sends a reminder mentioning the users who claimed attendance on the previous Korean date.
Split mentions into stable user-ID-ordered chunks of at most 40 users. Reserve each guild/date/chunk
in `attendance_reminder_runs` before sending, mark it sent afterward, and allow an unfinished
reservation to be retried after five minutes. Explicitly allow only those user IDs in Discord's
allowed mentions so reminders ping participants without enabling arbitrary mentions.

`attendance_streaks` stores the current streak, longest streak, and last attendance date per guild
and user. A claim on the Korean calendar day immediately following the last claim increments the
current streak; otherwise it resets to one. The longest streak never decreases. Streak updates are
part of the claim transaction. If a streak row is missing for an existing user, rebuild it from
`attendance_claims` before saving. Leaderboards rank longest streak first and current streak second.
Display the current streak as zero after a missed Korean calendar day, while preserving the stored
longest streak. Read SQL `DATE` values with `DATE_FORMAT(..., '%Y-%m-%d')` to avoid driver timezone
shifts.

Voice activity rewards are configured per guild with a base amount per five minutes and a per-user
daily cap. Both `0.00` values disable the feature. A reward requires at least one eligible human
in a voice channel; bots and deafened members are excluded, and leaving, moving, or becoming
ineligible resets continuous presence. The participant multiplier is 2x for two people, 1.5x for
three, 1.25x for four, and 1x for five or more. A solo non-deafened member receives 3x so the user
who starts a voice room is rewarded. Message activity never earns currency. Use
`(guild_id, user_id, reward_bucket)` to deduplicate five-minute intervals and the
`Asia/Seoul` date for the cap. Insert the reward record, credit the balance, and write the
`voice_activity` ledger row in one database transaction. Notifications are intentionally omitted
for these frequent automatic credits to avoid channel spam.

The ordinary web dashboard may expose configured reward amounts to guild members. Calculate every
displayed participant tier through the same integer-cent reward function used by the award service,
subtract today's `voice_activity_rewards` from the daily cap to show the authenticated user's
remaining Korean-calendar allowance, and hide the reward card when either the base reward or daily
cap is `0.00`.

Monthly balance burn settings are stored per guild as an enabled flag, integer basis points
(`1000` = `10.00%`), Korean-calendar day 1-28, hour, minute, and the next UTC epoch timestamp. New
schedules default to day 1 at 12:00 KST and 10%. Initializing an existing guild schedules only the
next future occurrence; it must not retroactively burn the current month. At execution, lock the
guild setting and every positive account, calculate `floor(balance_cents * basis_points / 10000)`,
skip results below one cent, debit each account, and write one `monthly_burn` ledger row per debit
inside the same database transaction. The unique `(guild_id, burn_period)` run record prevents a
second burn in the same Korean calendar month. After commit, send at most one best-effort summary
notification for the guild.

Use row locks for debit operations. A failed insufficient-balance check must change neither the
balance nor the ledger. Discord notifications are sent after commit and intentionally swallow
delivery failures so an external Discord error cannot invalidate completed money movement.

Personal history may include rows where the current user is sender or recipient. The web admin
dashboard may show the selected guild's latest server-wide ledger rows only after enforcing
manage-guild permission on the server. Every query must include the selected `guild_id`; never rely
on a hidden control or client-side route guard for access isolation.

Personal history displays the user's balance immediately after each listed transaction. Derive it
exactly with integer cents by starting from the current guild balance and walking ledger rows from
newest to oldest, reversing credits and debits after recording each row's displayed balance. This
keeps legacy rows usable without storing mutable balance snapshots.

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
Discord REST or gateway startup can fail transiently. Await `Client.login()` so rejections are
handled, destroy the failed client, and retry with capped backoff while leaving the web server
online. Never start overlapping login attempts or bot clients.

Dashboard connection status must come from the live Discord client. Report a selected guild as
connected only when the client is ready and its guild cache contains that exact `guild_id`; never
render a hardcoded connected badge.

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
