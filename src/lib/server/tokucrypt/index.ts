import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { argon2id } from 'hash-wasm';

export class TokucryptError extends Error {
	constructor(public code: 'format' | 'version' | 'auth' | 'config' | 'limit' | 'input') {
		super(code);
	}
}
const fail = (code: TokucryptError['code']): never => {
	throw new TokucryptError(code);
};
const MAX_BYTES = 2800;
const MEMORY = 19456;
const ITERATIONS = 2;
const requests = new Map<string, { count: number; expires: number }>();
let active = 0;

// Fixed-width big-endian header: version(1), key ID(16, zero padded ASCII),
// guild snowflake(8), Argon2 memory KiB(4), iterations(1), lanes(1), salt(16), nonce(12).
// Entire 59-byte header is AAD; ciphertext follows, then the 16-byte GCM tag.
function config() {
	try {
		const keys: unknown = JSON.parse(process.env.TOKUCRYPT_KEYS ?? '');
		const current = process.env.TOKUCRYPT_ACTIVE_KEY_ID ?? '';
		if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return fail('config');
		const ring = new Map<string, Buffer>();
		for (const [id, value] of Object.entries(keys)) {
			if (
				!/^[A-Za-z0-9_-]{1,16}$/.test(id) ||
				typeof value !== 'string' ||
				!/^[0-9a-fA-F]{64}$/.test(value)
			)
				return fail('config');
			ring.set(id, Buffer.from(value, 'hex'));
		}
		if (!ring.has(current)) return fail('config');
		return { ring, current };
	} catch {
		return fail('config');
	}
}
async function key(password: string, master: Buffer, header: Buffer) {
	const material = Buffer.from(
		await argon2id({
			password,
			salt: header.subarray(31, 47),
			memorySize: MEMORY,
			iterations: ITERATIONS,
			parallelism: 1,
			hashLength: 32,
			outputType: 'binary'
		})
	);
	const guildKey = Buffer.from(
		hkdfSync('sha256', master, header.subarray(17, 25), 'TOKUCRYPT/TK1/guild', 32)
	);
	const combined = Buffer.alloc(72);
	combined.writeUInt32BE(32, 0);
	material.copy(combined, 4);
	combined.writeUInt32BE(32, 36);
	guildKey.copy(combined, 40);
	try {
		return Buffer.from(
			hkdfSync('sha256', combined, header.subarray(31, 47), 'TOKUCRYPT/TK1/AES-256-GCM', 32)
		);
	} finally {
		material.fill(0);
		guildKey.fill(0);
		combined.fill(0);
	}
}
export async function transform(
	mode: 'encrypt' | 'decrypt',
	guild: string,
	user: string,
	input: string,
	password: string
): Promise<string> {
	if (
		!/^[1-9][0-9]{0,19}$/.test(guild) ||
		BigInt(guild) > 0xffffffffffffffffn ||
		!input.length ||
		!password.length ||
		password.length > 256 ||
		input.length > 4000
	)
		return fail('input');
	const now = Date.now();
	for (const [id, entry] of requests) if (entry.expires <= now) requests.delete(id);
	const entry = requests.get(user) ?? { count: 0, expires: now + 60_000 };
	if (entry.count >= 5 || active >= 2 || (requests.size >= 10000 && !requests.has(user)))
		return fail('limit');
	entry.count++;
	requests.set(user, entry);
	active++;
	try {
		const { ring, current } = config();
		let header: Buffer;
		let payload: Buffer | undefined;
		if (mode === 'encrypt') {
			if (Buffer.byteLength(input) > MAX_BYTES) return fail('input');
			header = Buffer.alloc(59);
			header[0] = 1;
			header.write(current, 1, 'ascii');
			header.writeBigUInt64BE(BigInt(guild), 17);
			header.writeUInt32BE(MEMORY, 25);
			header[29] = ITERATIONS;
			header[30] = 1;
			randomBytes(16).copy(header, 31);
			randomBytes(12).copy(header, 47);
		} else {
			if (/^TK[0-9]+\./.test(input) && !input.startsWith('TK1.')) return fail('version');
			if (!/^TK1\.[A-Za-z0-9_-]+$/.test(input)) return fail('format');
			payload = Buffer.from(input.slice(4), 'base64url');
			if (
				payload.toString('base64url') !== input.slice(4) ||
				payload.length < 76 ||
				payload.length > MAX_BYTES + 75
			)
				return fail('format');
			header = payload.subarray(0, 59);
			if (header[0] !== 1) return fail('version');
			if (
				header.readBigUInt64BE(17) !== BigInt(guild) ||
				header.readUInt32BE(25) !== MEMORY ||
				header[29] !== ITERATIONS ||
				header[30] !== 1
			)
				return fail('auth');
		}
		const id = header.subarray(1, 17).toString('ascii').replace(/\0+$/, '');
		if (
			!/^[A-Za-z0-9_-]{1,16}$/.test(id) ||
			!header.subarray(1, 17).equals(Buffer.concat([Buffer.from(id), Buffer.alloc(16 - id.length)]))
		)
			return fail('auth');
		const master = ring.get(id);
		if (!master) return fail('auth');
		const derived = await key(password, master, header);
		try {
			if (mode === 'encrypt') {
				const cipher = createCipheriv('aes-256-gcm', derived, header.subarray(47, 59));
				cipher.setAAD(header);
				const encrypted = Buffer.concat([cipher.update(input, 'utf8'), cipher.final()]);
				return (
					'TK1.' + Buffer.concat([header, encrypted, cipher.getAuthTag()]).toString('base64url')
				);
			}
			const decipher = createDecipheriv('aes-256-gcm', derived, header.subarray(47, 59));
			decipher.setAAD(header);
			decipher.setAuthTag(payload!.subarray(-16));
			try {
				return new TextDecoder('utf-8', { fatal: true }).decode(
					Buffer.concat([decipher.update(payload!.subarray(59, -16)), decipher.final()])
				);
			} catch {
				return fail('auth');
			}
		} finally {
			derived.fill(0);
		}
	} finally {
		active--;
	}
}
