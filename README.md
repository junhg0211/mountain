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

## Commands

- `/balance [user]` shows a balance. It is localized as `/잔액` and `/残高`.
- `/pay user:<user> amount:<amount>` transfers money. It is localized as `/송금` and `/送金`.
- `/ranking` shows the server balance ranking. It is localized as `/순위` and `/ランキング`.
- `/settings currency unit:<unit>` sets the server currency unit. It is localized as `/설정 통화`
  and `/設定 通貨`.
- `/settings voice-reward reward:<amount> daily-cap:<amount>` configures voice activity rewards.
  It is localized as `/설정 음성보상` and `/設定 ボイス報酬`.
- `/dashboard` opens the web dashboard. It is localized as `/대시보드` and `/ダッシュボード`.
- `/bet` creates, joins, views, settles, or refunds server betting pools. It is localized as
  `/베팅` and `/ベット`.
- `/attendance` claims the server's daily reward or shows the streak ranking. It is localized as
  `/출석` and `/出席`.

Money values use two decimal places, so the minimum transferable amount is `0.01`.
Balances are isolated per Discord server.

Voice activity rewards are paid every five continuous eligible minutes. Two-person channels pay
2x the base reward, three-person channels 1.5x, four-person channels 1.25x, and larger channels 1x.
Bots, deafened users, solo users, and message activity receive no reward. Administrators can set
the base reward and per-user daily cap from Discord or the web admin dashboard; setting both to
`0.00` disables the feature.

## Betting dashboard

`/bets` provides a dedicated betting dashboard with one detail page per pool, fixed quick-bet
amounts, owner settlement/refund controls, and live participant updates over authenticated
WebSockets.

New pools offer A-team/B-team pari-mutuel betting. The detail page shows live team percentages,
estimated payout for every quick-bet amount, an event feed, and per-user participation, winnings,
returned amount, hit rate, and net profit. The winning team's users share the complete pot in
proportion to their stakes.

Production must be built with `bun run build` and started with `bun run start`. The custom
`server.ts` entry serves SvelteKit and betting WebSocket upgrades on the same port.

## Contributor reference

Read [`AGENTS.md`](./AGENTS.md) before making changes. Detailed economy, transaction ledger,
database migration, Discord registration, authorization, verification, and commit rules are in
[`docs/ECONOMY_DEVELOPMENT.md`](./docs/ECONOMY_DEVELOPMENT.md).
