import {
	createHash,
	createPrivateKey,
	createPublicKey,
	diffieHellman,
	generateKeyPairSync,
	hkdfSync,
	type KeyObject
} from 'node:crypto';

export const GROUP_ID = 'X25519';
export class DhError extends Error {
	constructor(public code: 'public' | 'format' | 'limit') {
		super(code);
	}
}
const fail = (code: DhError['code']): never => {
	throw new DhError(code);
};
// RFC 8410 PKCS#8 wrapper for the raw 32-byte X25519 private value.
const PRIVATE_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
function decode(value: string) {
	if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return fail('format');
	const raw = Buffer.from(value, 'base64url');
	if (raw.length !== 32 || raw.toString('base64url') !== value) return fail('format');
	return raw;
}
function privateObject(value: string): KeyObject {
	const raw = decode(value);
	const der = Buffer.concat([PRIVATE_PREFIX, raw]);
	try {
		return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
	} finally {
		raw.fill(0);
		der.fill(0);
	}
}
function publicObject(value: string) {
	const raw = decode(value);
	// This application accepts canonical field elements only so the transcript has one encoding.
	const prime = (1n << 255n) - 19n;
	if (BigInt('0x' + Buffer.from(raw).reverse().toString('hex')) >= prime) return fail('public');
	return createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: value }, format: 'jwk' });
}
const requests = new Map<string, { count: number; expires: number }>();
export function limitDh(user: string) {
	const now = Date.now();
	for (const [id, item] of requests) if (item.expires <= now) requests.delete(id);
	const item = requests.get(user) ?? { count: 0, expires: now + 60_000 };
	if (item.count >= 5 || (!requests.has(user) && requests.size >= 10000)) fail('limit');
	item.count++;
	requests.set(user, item);
}
export function generatePair() {
	const pair = generateKeyPairSync('x25519');
	return {
		privateKey: pair.privateKey.export({ format: 'jwk' }).d!,
		publicKey: pair.publicKey.export({ format: 'jwk' }).x!
	};
}
export function sharedKey(guild: string, privateKey: string, peerPublicKey: string) {
	const own = privateObject(privateKey);
	const peer = publicObject(peerPublicKey);
	const ownPublic = createPublicKey(own).export({ format: 'jwk' }).x!;
	if (ownPublic === peerPublicKey) return fail('public');
	// Version and curve separate this protocol from previous finite-field DH keys.
	const context = JSON.stringify([
		'Mountain/DH3',
		GROUP_ID,
		guild,
		...[ownPublic, peerPublicKey].sort()
	]);
	const transcript = createHash('sha256').update(context).digest();
	let secret: Buffer;
	try {
		secret = diffieHellman({ privateKey: own, publicKey: peer });
	} catch {
		return fail('public');
	}
	try {
		if (secret.every((byte) => byte === 0)) return fail('public');
		return {
			key: Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(32), transcript, 32)).toString(
				'base64url'
			),
			fingerprint: transcript.toString('hex')
		};
	} finally {
		secret.fill(0);
	}
}
