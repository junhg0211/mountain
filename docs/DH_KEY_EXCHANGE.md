# X25519 key exchange

## Setup and use

Key exchange uses X25519 (RFC 7748 section 6.1). Private keys, public keys and derived passwords
are all 32-byte values displayed as exactly 43 unpadded base64url characters. No key registration,
lookup service or permanent key storage is required.

`DH_P`, `DH_Q` and `DH_SIGNING_KEY` are no longer used and can be removed from deployment
configuration. Existing TOKUCRYPT keys remain required for encryption/decryption.
The previous finite-field decimal key pairs cannot be used in this version; both participants
must generate new pairs. Already derived old passwords still decrypt existing ciphertext.

1. Each participant runs `/암호 키쌍생성`. Keep the private key secret and exchange only the
   complete 43-character public key. Replies are ephemeral.
2. `/암호 공유키생성` takes your private key and your peer's public key. Your own public key is
   computed automatically. There is no group selection or parameter command.
3. Copy the resulting 43-character password into existing encryption/decryption commands.
   Preserve case and avoid spaces or code fences. A decrypted Discord ID is a claim, not proof
   of account ownership.

The command map already includes `crypt`. Re-register the complete list through `reloadCommands`
when command definitions change (see ECONOMY_DEVELOPMENT.md). Registration preserves the global
Activity Entry Point and does not start a second gateway client.

## Protocol and security review

OpenSSL generates independent X25519 key pairs and performs private scalar operations. Raw private
values use the RFC 8410 PKCS#8 wrapper for import. The application requires canonical unpadded
base64url and canonical public field elements below 2^255-19; unlike the general RFC 7748 function,
this application's input format rejects high-bit/noncanonical aliases. Native X25519 failures,
low-order inputs producing zero secrets and reflected own keys are rejected. All-zero shared secrets
are explicitly rejected as well. Inputs are bounded before decoding; each caller is limited to five
requests per minute. Fresh Discord membership checks precede generation and derivation.

DH3 uses the native 32-byte shared secret and HKDF-SHA256 with a 32-byte zero salt. The info is
SHA256(JSON(["Mountain/DH3","X25519",guild,...lexically sorted canonical base64url public keys])).
This binds the protocol, curve, guild and both public keys independent of direction. The hash is
internal key-derivation context and is not returned or displayed. Public keys do not authenticate
a sender, and no exchange verification value is provided; active key substitution is not detected.
The output is 32 bytes in unpadded base64url. Existing Argon2id, server-derived guild keys and
AES-256-GCM are unchanged. Private import buffers and shared-secret buffers are cleared after use;
JavaScript strings and native key-object memory cannot be explicitly zeroized by this application.

Discord and the bot server receive secrets; this does not provide end-to-end encryption against
those services. Ephemeral messages may be copied by recipients. Secret inputs use modals and all
DH responses are ephemeral. Exceptions carrying secrets are contained without forwarding interaction
payloads to shared logging. No user keys are persisted. Before real secret communication,
independently review the deployed anonymous-channel flow and its sender-authentication limitations.

Tests include the RFC 7748 section 6.1 known-answer exchange, symmetric derivation, exact key lengths,
existing cipher round trips, malformed and noncanonical encodings, low-order public values,
reflection, guild/transcript binding and ephemeral sanitized Discord replies.

Sources:

- https://www.rfc-editor.org/rfc/rfc7748.html#section-6.1
- https://www.rfc-editor.org/rfc/rfc8410.html#section-7
