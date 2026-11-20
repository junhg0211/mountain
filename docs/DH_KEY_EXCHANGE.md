# DH key exchange

## Public server parameters

The server uses RFC 7919 ffdhe2048 with g=2, a 2048-bit safe prime p and q=(p-1)/2.
These are public constants, not secrets. Do not generate arbitrary replacement primes.
Source: https://www.rfc-editor.org/rfc/rfc7919.html#appendix-A.1

`.env.example` contains the complete decimal `DH_P` and `DH_Q` values. To print a fresh copy
of the standard configuration from the repository root:

```sh
bun -e "import { parameterEnvironment } from './src/lib/server/tokucrypt/dh.ts'; process.stdout.write(parameterEnvironment());"
```

Copy the two output lines into the deployment environment. Keep each number on a single line.
When both variables are omitted, the same standard group is used. If either is set, both must
exactly match the supported standard pair; commands fail closed for mismatched or custom values.
Validation runs before DH operations. `DH_SIGNING_KEY` is no longer used and may be removed.
Existing TOKUCRYPT keys remain necessary for encryption/decryption.

## Use

1. `/암호 매개변수생성` displays the public group, g, p and q.
2. Each participant runs `/암호 키쌍생성`. Keep the private number secret; exchange only the
   public decimal number. Responses are ephemeral. No certificates or expiry apply.
3. `/암호 공유키생성` takes your private number and the peer's public number. Your own public
   key is computed automatically. The fixed group defaults to ffdhe2048.
4. Compare the full exchange fingerprint through a trusted path associated with the intended
   participant. Numeric public keys do not authenticate a sender: an attacker who substitutes
   keys can perform a man-in-the-middle attack unless this comparison is trustworthy.
5. Copy the resulting 43-character password into existing encryption/decryption commands.
   Avoid whitespace and code fences. A decrypted Discord ID is a claim, not proof of ownership.

The command map already includes `crypt`. Re-register the complete command list using
`reloadCommands` after deployment (see ECONOMY_DEVELOPMENT.md). Registration preserves the global
Activity Entry Point and does not start a second gateway client.

## Implementation review

Exponents are independent, uniform rejection samples in [1,q-1] from cryptographic random bytes.
OpenSSL performs secret exponent operations; JavaScript modular exponentiation only validates
public subgroup membership. Public values require 2 <= B <= p-2 and B^q mod p = 1. Inputs are
bounded before integer parsing; requests are limited to five per user per minute. Fresh Discord
membership checks remain required for command execution. No user keys are persisted or logged.

DH2 derives a 256-byte big-endian shared integer. HKDF-SHA256 uses a 32-byte zero salt and the
SHA256 hash of JSON(["Mountain/DH2",group,guild,...sorted fixed-width hexadecimal public keys])
as info. This hash is also displayed as the fingerprint. Fixed-width encoding normalizes leading
zeros and key order. The output is 32 bytes in unpadded base64url. Existing Argon2id, server-derived
guild keys and AES-256-GCM remain unchanged. New DH2 keys differ from prior DH1 certificate keys;
already generated passwords remain usable with existing ciphertext.

Discord and the bot server receive secrets; this is not end-to-end encryption against those
services. Ephemeral messages may be copied by recipients. JavaScript strings cannot be reliably
zeroized; computed shared-secret buffers are cleared. Exceptions containing secret input are
contained without forwarding to shared logging. Numeric keys deliberately remove the former
server-issued ownership/session certificate; fingerprints require a trusted comparison channel.
Independently review the complete deployed anonymous-channel flow before real secret communication.
