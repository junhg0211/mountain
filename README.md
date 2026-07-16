# Mountain

opensource discord economy bot with website and dashboard

## Development

1. Copy `.env.example` to `.env` and fill in the Discord and MariaDB values.
2. Apply `database.sql` to MariaDB.
3. Run `bun install` and `bun run dev`.

Set `REGISTER_COMMANDS=true` only when Discord slash commands need to be registered.

## Commands

- `/ping` checks the bot latency.
- `/balance` shows your current balance. It is shown as `/잔액` in Korean and `/残高` in Japanese.
- `/pay user:<user> amount:<amount>` transfers money. It is shown as `/송금` in Korean and `/送金` in Japanese.
- `/settings currency unit:<unit>` sets the server currency unit. It is shown as `/설정 통화` in Korean and `/設定 通貨` in Japanese.

Money values use two decimal places, so the minimum transferable amount is `0.01`.
Balances are isolated per Discord server.
