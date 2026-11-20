# DH key exchange

## Setup and use

Set `DH_SIGNING_KEY` to an independently generated 32-byte hexadecimal secret in the server
environment (`openssl rand -hex 32`). Keep it stable across restarts and identical across instances.
It is separate from TOKUCRYPT keys; rotating it invalidates outstanding public-key certificates.
No user keys or identities are stored in a database. Missing configuration fails closed.

The existing command map already contains `crypt`; its definition now includes `parameters`,
`keypair`, and `shared`, localized in English, Korean and Japanese. Re-register the complete command
list with `reloadCommands` (see ECONOMY_DEVELOPMENT.md); its bulk overwrite preserves the Activity
Entry Point. Registration uses REST and does not start another gateway client.

1. `/암호 매개변수생성` shows the public ffdhe2048 group, g=2 and decimal p.
2. Each participant runs `/암호 키쌍생성`, keeps the private exponent, and copies only the
   complete `DH1.…` signed public-key certificate to the anonymous channel. All replies are ephemeral.
3. Within 24 hours, each runs `/암호 공유키생성` and enters their private exponent, their own
   certificate and their peer's certificate. The group defaults to ffdhe2048. Raw public integers
   are deliberately not accepted: accepting them would discard authenticated sender/session binding.
4. Compare the full exchange fingerprint through a trusted path bound to the intended anonymous
   participant. A valid certificate proves issuance by Mountain, not the identity of an anonymous
   poster. A relay can replace both certificates with legitimately issued attacker certificates;
   checking the fingerprint is essential for protection against that active attack.
5. Copy the 43-character shared password into the existing encryption/decryption password field.
   Do not copy code fences, whitespace or newlines. A decrypted Discord ID remains a claim until
   verified from the account concerned. Identity disclosure is optional.

## Protocol and implementation security review

The pinned prime is RFC 7919 Appendix A.1:
https://www.rfc-editor.org/rfc/rfc7919.html#appendix-A.1
No custom parameters are accepted. q=(p-1)/2; rejection sampling over cryptographic 256-byte random
values selects a uniform exponent in [1,q-1]. OpenSSL performs private exponentiation; JavaScript
modular exponentiation is used only for public subgroup validation. Inputs are length bounded before
integer parsing. Public keys require 2 <= B <= p-2 and B^q mod p = 1. Requests are limited to five
per user per minute, with a bounded rate-limit map.

Certificates contain guild, random nonce, per-key HMAC pseudonym, expiry and decimal public key.
HMAC-SHA256 covers the DH1 version and entire payload. No Discord user ID appears in the certificate;
the pseudonym is HMAC(domain,guild,authenticated user,nonce). Fresh REST membership checks precede
issuance and derivation; the own certificate must match both the authenticated caller and exponent.
Certificates expire after 24 hours and cannot cross guilds. They are not one-time tokens; no replay
registry or permanent user-key storage is introduced.

The shared integer is serialized to exactly 256 big-endian bytes. HKDF-SHA256 uses 32 zero salt
bytes and SHA256(JSON(["Mountain/DH1",group,guild,...lexically sorted complete certificates])) as info.
The transcript hash is also the displayed fingerprint. Output is 32 bytes encoded as unpadded
base64url. The existing Argon2id, server-derived guild key and AES-256-GCM path remains unchanged.
The server and Discord receive secrets, so this is not end-to-end encryption against either service.
Compromise of the server's TOKUCRYPT key plus a shared password enables decryption of that guild's
ciphertext. Server-generated and submitted exponents are ephemeral process values, not persisted;
JavaScript strings cannot be reliably zeroized. Computed shared-secret buffers are cleared.

Secret inputs use modals; results use ephemeral responses. All errors in DH handling, including
Discord response failures, are contained without forwarding interaction payloads to logs. Ephemeral
messages still exist at Discord and can be copied or captured by the recipient.

Automated coverage verifies the safe prime, subgroup, independent generation, symmetric HKDF,
existing cipher round trips, ownership/guild binding, tampering, expiry and bounded inputs/output.
Before real secret communications, independently review the deployed server, Discord permissions,
anonymous-channel identity binding and fingerprint verification procedure. This implementation review
and automated tests do not replace an independent cryptographic audit.
