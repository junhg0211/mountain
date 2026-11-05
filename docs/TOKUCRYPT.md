# TOKUCRYPT

`/암호 암호화`, `/암호 복호화` (English: `/crypt encrypt`, `/crypt decrypt`)
open Discord modals. Results and UTF-8 attachments are ephemeral. Password fields
are visible on screen; Discord receives modal submissions. Never enter passwords
in public chat. No plaintext, passwords, ciphertext history or request payloads
are persisted or logged by this feature.

## Deployment and rotation

Generate a dedicated master key with `openssl rand -hex 32`. Store it in the
production secret manager/environment as `TOKUCRYPT_KEYS={"v1":"<64 hex digits>"}`
and set `TOKUCRYPT_ACTIVE_KEY_ID=v1`. Do not commit real keys. Missing or invalid
configuration disables cryptographic operations without stopping other commands.
Back up the key ring securely: losing a key makes its ciphertext unrecoverable.

For rotation, add a newly generated `v2` entry, keep `v1`, and switch the active
ID to `v2`. Deploy the same key ring on every instance and preserve it across
restarts. Old ciphertext continues to use its original key ID. IDs are 1–16 ASCII
letters, digits, underscores or hyphens. Removing an old key prevents decryption.

Register the complete command list using the existing `reloadCommands` function
or `REGISTER_COMMANDS=true` on the next normal `bun run start`. The registration
preserves the global Activity Entry Point. Do not start a second bot process.
Global propagation can take time. No database migration or dashboard change is needed.

## TK1 binary format

The wire string is `TK1.` followed by canonical, unpadded Base64url. All integers
are unsigned big-endian. The 59-byte header contains, in order:

| Offset | Bytes | Value                                |
| ------ | ----- | ------------------------------------ |
| 0      | 1     | Format version 1                     |
| 1      | 16    | Key ID, ASCII padded with zero bytes |
| 17     | 8     | Discord guild snowflake              |
| 25     | 4     | Argon2id memory in KiB, 19456        |
| 29     | 1     | Argon2id iterations, 2               |
| 30     | 1     | Argon2id parallelism, 1              |
| 31     | 16    | Random salt                          |
| 47     | 12    | Random GCM nonce                     |

The header is followed by UTF-8 ciphertext, then the 16-byte GCM tag. The complete
header is AES-GCM AAD. Only the documented KDF profile is accepted, before any
Argon2 work. hash-wasm provides Argon2id (v19), producing 32 bytes. HKDF-SHA256
first derives a guild key from the master key, guild ID as salt, and info
`TOKUCRYPT/TK1/guild`. Final HKDF input is `uint32(32) || passwordMaterial ||
uint32(32) || guildKey`, with the random salt and info
`TOKUCRYPT/TK1/AES-256-GCM`. The output is the 32-byte AES key.

Plaintext is limited to 2,800 UTF-8 bytes, ensuring ciphertext fits the 4,000
character decryption modal. Passwords allow 256 UTF-16 code units and are never
trimmed or normalized. Outputs exceeding 2,000 characters use ephemeral files;
copy the file contents into the decryption modal. Authentication completes before
any plaintext is returned. Another guild cannot decrypt the ciphertext.

Limits are five operations per user per minute across guilds and two concurrent
operations per bot process (about 38 MiB Argon2 working memory). Excess requests
are rejected without queuing. Rate-limit entries expire after one minute and the
map is bounded. Multiple deployments need a shared limiter if used in future.

Run `bun test src/lib/server/tokucrypt`. Live Discord QA should check modal opening,
private inline/file responses, guild membership rejection, and existing commands.
