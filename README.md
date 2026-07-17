# Mountain

opensource discord economy bot with website and dashboard

## Development

1. Copy `.env.example` to `.env` and fill in the Discord and MariaDB values.
2. Run `bun install` and `bun run dev`.

The app creates the configured database, missing tables, columns, and indexes automatically on
its first database access. The configured MariaDB user therefore needs permission to create the
database. `database.sql` remains available for manual provisioning if your deployment uses a
restricted database user.

Set `REGISTER_COMMANDS=true` only when Discord slash commands need to be registered.

## Discord Activity

The same dashboard can run inside Discord as an Activity. In an Activity frame, Mountain uses the
official Embedded App SDK to request `identify` and `guilds`, exchanges the one-time code on the
server, authenticates the SDK session, and issues a secure partitioned web session. Normal browser
OAuth remains available outside Discord.

Complete the Developer Portal URL mapping and Activity toggle described in
[`docs/DISCORD_ACTIVITY_SETUP.md`](./docs/DISCORD_ACTIVITY_SETUP.md). Command synchronization
preserves Discord's Activity Entry Point command when bulk-reloading slash commands.

## Commands

- `/autopay list|create|cancel` (`/자동송금`, `/自動送金`) manages recurring transfers. A new
  transfer does not charge immediately; supported schedules are every N days, weekly, and monthly.
- `/subscription list|join|cancel` (`/구독`, `/サブスク`) manages existing-role subscriptions.
  Joining charges the full monthly price immediately and renewals run on the 1st at 12:00 KST.

- `/balance [user]` shows a balance. It is localized as `/잔액` and `/残高`.
- `/pay user:<user> amount:<amount>` transfers money. It is localized as `/송금` and `/送金`.
- `/ranking` shows the server balance ranking. It is localized as `/순위` and `/ランキング`.
- `/settings currency unit:<unit>` sets the server currency unit. It is localized as `/설정 통화`
  and `/設定 通貨`.
- `/settings voice-reward reward:<amount> daily-cap:<amount>` configures voice activity rewards.
  It is localized as `/설정 음성보상` and `/設定 ボイス報酬`.
- `/settings monthly-burn enabled:<bool> percentage:<percent> day:<day> hour:<hour> minute:<minute>`
  configures the monthly balance burn. It is localized as `/설정 월간소각` and `/設定 月次バーン`.
- `/dashboard` opens the web dashboard. It is localized as `/대시보드` and `/ダッシュボード`.
- `/bet` creates, joins, views, settles, or refunds server betting pools. It is localized as
  `/베팅` and `/ベット`.
- `/attendance` claims the server's daily reward or shows the streak ranking. It is localized as
  `/출석` and `/出席`.

Money values use two decimal places, so the minimum transferable amount is `0.01`.
Balances are isolated per Discord server.

Voice activity rewards are paid every five continuous eligible minutes. Solo channels pay 3x the
base reward, two-person channels 2x, three-person channels 1.5x, four-person channels 1.25x, and
larger channels 1x. Bots, deafened users, and message activity receive no reward. Administrators
can set the base reward and per-user daily cap from Discord or the web admin dashboard; setting
both to `0.00` disables the feature.

Monthly balance burn is enabled per server by default at 10% on the first day of each month at
12:00 KST. Administrators can change the percentage (0.01%-100%), day (1-28), and time or disable
it from `/settings monthly-burn` or the web admin dashboard. Each account is rounded down to the
nearest cent, recorded in the ledger, and processed at most once per Korean calendar month.

When voice rewards are enabled, the main web dashboard shows the exact five-minute reward for
solo, two-person, three-person, four-person, and larger channels together with the per-user daily
reward remaining after today's payments. Disabled rewards remain hidden.

## Betting dashboard

`/bets` provides a dedicated betting dashboard with one detail page per pool, fixed quick-bet
amounts, owner settlement/refund controls, and live participant updates over authenticated
WebSockets.

New pools offer A-team/B-team pari-mutuel betting. The detail page shows live team percentages,
estimated payout for every quick-bet amount, an event feed, and per-user participation, winnings,
returned amount, hit rate, and net profit. The winning team's users share the complete pot in
proportion to their stakes.

Production must be built with `bun run build` and started with `bun run start`. The custom
`server.ts` entry starts the Discord bot immediately, then serves SvelteKit and betting WebSocket
upgrades on the same port. Bot startup does not wait for the first website request.

## Contributor reference

Read [`AGENTS.md`](./AGENTS.md) before making changes. Detailed economy, transaction ledger,
database migration, Discord registration, authorization, verification, and commit rules are in
[`docs/ECONOMY_DEVELOPMENT.md`](./docs/ECONOMY_DEVELOPMENT.md).

Public legal pages are available at `/terms` and `/privacy`. The shared site footer links to both
pages and the operator contact address. Keep the disclosed data categories, retention periods,
hosting location, and third-party integrations synchronized with implementation changes.

The web admin dashboard shows the selected guild's 50 most recent ledger transactions, including
the operation type, sender, recipient, amount, timestamp, and linked betting pool. This server-wide
history is available only after an authenticated manage-guild permission check.
