import { createDiffieHellman, createHash, hkdfSync, randomBytes } from 'node:crypto';

export const GROUP_ID = 'ffdhe2048';
// RFC 7919, Appendix A.1. Only this pinned group is accepted.
export const PRIME_HEX = `FFFFFFFF FFFFFFFF ADF85458 A2BB4A9A AFDC5620 273D3CF1
D8B9C583 CE2D3695 A9E13641 146433FB CC939DCE 249B3EF9
7D2FE363 630C75D8 F681B202 AEC4617A D3DF1ED5 D5FD6561
2433F51F 5F066ED0 85636555 3DED1AF3 B557135E 7F57C935
984F0C70 E0E68B77 E2A689DA F3EFE872 1DF158A1 36ADE735
30ACCA4F 483A797A BC0AB182 B324FB61 D108A94B B2C8E3FB
B96ADAB7 60D7F468 1D4F42A3 DE394DF4 AE56EDE7 6372BB19
0B07A7C8 EE0A6D70 9E02FCE1 CDF7E2EC C03404CD 28342F61
9172FE9C E98583FF 8E4F1232 EEF28183 C3FE3B1B 4C6FAD73
3BB5FCBC 2EC22005 C58EF183 7D1683B2 C6F34A26 C1B2EFFA
886B4238 61285C97 FFFFFFFF FFFFFFFF`
	.replace(/\s/g, '')
	.toLowerCase();
export const P = BigInt('0x' + PRIME_HEX);
export const Q = (P - 1n) / 2n;
export class DhError extends Error {
	constructor(public code: 'group' | 'private' | 'public' | 'format' | 'config' | 'limit') {
		super(code);
	}
}
const fail = (code: DhError['code']): never => {
	throw new DhError(code);
};
export function validateGroup(group: string) {
	if (group !== GROUP_ID) fail('group');
	validateParameters();
}
// Configuration is an allowlist, not permission to use arbitrary DH parameters.
export function validateParameters() {
	const p = process.env.DH_P;
	const q = process.env.DH_Q;
	if (p === undefined && q === undefined) return;
	if (p !== P.toString() || q !== Q.toString()) fail('config');
}
export function parameterEnvironment() {
	return `DH_P=${P}\nDH_Q=${Q}\n`;
}
function number(value: string) {
	if (!/^[0-9]{1,617}$/.test(value)) return fail('format');
	return BigInt(value);
}
export function validatePrivate(value: string) {
	const a = number(value);
	if (a < 1n || a >= Q) return fail('private');
	return a;
}
// This exponent is public. Secret exponent operations use OpenSSL below.
function pow(base: bigint, exponent: bigint) {
	let result = 1n;
	for (; exponent; exponent >>= 1n, base = (base * base) % P)
		if (exponent & 1n) result = (result * base) % P;
	return result;
}
export function validatePublic(value: string) {
	const b = number(value);
	if (b < 2n || b > P - 2n || pow(b, Q) !== 1n) return fail('public');
	return b;
}
const bytes = (value: bigint) => Buffer.from(value.toString(16).padStart(512, '0'), 'hex');
function engine(a: bigint) {
	const dh = createDiffieHellman(Buffer.from(PRIME_HEX, 'hex'), 2);
	dh.setPrivateKey(bytes(a));
	dh.generateKeys();
	return dh;
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
export function generatePair(group: string) {
	validateGroup(group);
	let a: bigint;
	do {
		a = BigInt('0x' + randomBytes(256).toString('hex'));
	} while (a < 1n || a >= Q);
	return {
		privateKey: a.toString(),
		publicKey: BigInt('0x' + engine(a).getPublicKey('hex')).toString()
	};
}
export function sharedKey(group: string, guild: string, privateKey: string, peerPublicKey: string) {
	validateGroup(group);
	const a = validatePrivate(privateKey);
	const peer = validatePublic(peerPublicKey);
	const dh = engine(a);
	const own = BigInt('0x' + dh.getPublicKey('hex'));
	if (own === peer) return fail('public');
	// Fixed-width public values form a canonical transcript regardless of input order/leading zeros.
	const publicKeys = [bytes(own).toString('hex'), bytes(peer).toString('hex')].sort();
	const context = JSON.stringify(['Mountain/DH2', GROUP_ID, guild, ...publicKeys]);
	const transcript = createHash('sha256').update(context).digest();
	const secret = dh.computeSecret(bytes(peer));
	try {
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
