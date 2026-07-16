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
- `/dashboard` opens the web dashboard. It is localized as `/대시보드` and `/ダッシュボード`.
- `/bet` creates, joins, views, settles, or refunds server betting pools. It is localized as
  `/베팅` and `/ベット`.
- `/attendance` claims the server's daily reward or shows the streak ranking. It is localized as
  `/출석` and `/出席`.

Money values use two decimal places, so the minimum transferable amount is `0.01`.
Balances are isolated per Discord server.

## Contributor reference

Read [`AGENTS.md`](./AGENTS.md) before making changes. Detailed economy, transaction ledger,
database migration, Discord registration, authorization, verification, and commit rules are in
[`docs/ECONOMY_DEVELOPMENT.md`](./docs/ECONOMY_DEVELOPMENT.md).
