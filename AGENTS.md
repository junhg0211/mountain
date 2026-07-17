# Mountain repository instructions

These rules apply to every change in this repository.

## Finish every change safely

1. Preserve unrelated user changes. Never reset or overwrite a dirty worktree.
2. Run `bun run check` and `bun run build` after code changes. Resolve all errors and warnings.
3. Run `git diff --check` and review the final diff.
4. Commit every completed change with a concise English commit message. Stage only files belonging
   to the task; never include unrelated changes.
5. Report the commit hash and verification results.

## Economy invariants

- Economy data is isolated by Discord `guild_id`. Every account, balance query, transaction, and
  setting must include the guild context.
- Money has exactly two decimal places and the minimum positive amount is `0.01`. Parse external
  input with `parseMoney` and calculate with integer cents/`bigint`; never use floating-point math.
- Every balance mutation must write its ledger row to `transactions` inside the same database
  transaction. A balance change without a ledger record is not allowed.
- Ledger direction is fixed: transfer = sender and recipient, mint = null sender and target
  recipient, burn = target sender and null recipient. Betting uses `bet_stake` (user to escrow),
  `bet_payout` (escrow to winner), and `bet_refund` (escrow back to participant), each linked by
  `betting_pool_id`. Attendance uses `attendance` with a null sender and the rewarded user as the
  recipient.
- Voice activity rewards use `voice_activity` with a null sender and the rewarded user as the
  recipient. They are limited by a per-user Korean-calendar daily cap and a unique five-minute
  reward bucket; never award message activity.
- Team betting uses option `A` or `B`. Settle the full escrow pot among the winning option in
  proportion to each winner's integer-cent stake, distribute remainder cents deterministically,
  and write one `bet_payout` ledger row per recipient in the settlement transaction.
- Lock affected accounts (`FOR UPDATE`) and check available balance before debits.
- Discord transaction notifications are best-effort and happen only after the database transaction
  commits. Notification failure must not roll back a successful monetary operation.
- User-facing transaction history must only expose records the authenticated user is allowed to
  see. Server-wide history requires an explicit manage-guild permission check.

## Security and integration

- Re-check sessions, guild membership, manage-guild permissions, and Discord membership on the
  server. Client-side hidden fields and disabled buttons are not authorization.
- Discord Activity authentication must exchange the one-time authorization code on the server.
  Never trust client-provided Discord identity, persist the Activity access token, or expose the
  client secret. Activity sessions require Secure, SameSite=None, Partitioned cookies.
- Keep Discord command names and descriptions localized in English, Korean, and Japanese.
- When slash commands change, update the command map and re-register the complete command list with
  Discord. Preserve the global Activity Entry Point during bulk overwrite. Global command
  propagation may take time.
- Only one Discord bot process may use a token at a time. Preserve graceful `SIGINT`/`SIGTERM`
  shutdown behavior.
- A transient Discord gateway/login failure must not terminate the web server. Always await the
  login promise, clean up the failed client, and retry with capped backoff without creating
  concurrent clients.
- Start production through `bun run start`/`server.ts` so authenticated betting WebSocket upgrades
  remain available and the Discord bot starts without an HTTP request; do not run `build/index.js`
  directly.
- For schema changes, update both `database.sql` and the bootstrap/repair statements in
  `src/lib/server/db.ts`, then verify the migration against the configured database when possible.
- Daily attendance is keyed by `(guild_id, user_id, attendance_date)` using the `Asia/Seoul`
  calendar date. Web and Discord claims must share this same key and atomic claim service. Update
  current and longest streaks in that same transaction; skipping a Korean calendar day resets only
  the current streak.

- Voice rewards allow one or more eligible humans in a voice channel. A solo non-deafened member
  earns the highest multiplier for starting the room. Bots and deafened members are excluded.
  Reset the five-minute presence timer when a member leaves, moves channels, or becomes ineligible.

See `docs/ECONOMY_DEVELOPMENT.md` for the detailed architecture and change checklist.
