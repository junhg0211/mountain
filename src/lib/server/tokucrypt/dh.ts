import {
	createDiffieHellman,
	createHash,
	createHmac,
	hkdfSync,
	randomBytes,
	timingSafeEqual
} from 'node:crypto';

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
function signingKey() {
	const hex = process.env.DH_SIGNING_KEY ?? '';
	if (!/^[a-fA-F0-9]{64}$/.test(hex)) return fail('config');
	return Buffer.from(hex, 'hex');
}
function mac(value: string) {
	return createHmac('sha256', signingKey()).update(value).digest();
}
function owner(guild: string, user: string, nonce: string) {
	return mac(JSON.stringify(['Mountain/DH1/owner', guild, user, nonce])).toString('base64url');
}
// No identities or secrets in the public token. The per-key pseudonym is unlinkable without the server key.
type Certificate = {
	guild: string;
	nonce: string;
	owner: string;
	expires: number;
	publicKey: string;
};
function certificate(token: string, guild: string): Certificate {
	if (token.length > 1400 || !/^DH1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))
		return fail('format');
	const [, payload, signature] = token.split('.');
	const signed = 'DH1.' + payload;
	if (
		Buffer.from(payload, 'base64url').toString('base64url') !== payload ||
		Buffer.from(signature, 'base64url').toString('base64url') !== signature
	)
		return fail('format');
	if (!timingSafeEqual(mac(signed), Buffer.from(signature, 'base64url'))) return fail('public');
	try {
		const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Certificate;
		if (
			c.guild !== guild ||
			typeof c.nonce !== 'string' ||
			typeof c.owner !== 'string' ||
			!Number.isSafeInteger(c.expires) ||
			c.expires <= Date.now() ||
			typeof c.publicKey !== 'string'
		)
			return fail('public');
		validatePublic(c.publicKey);
		return c;
	} catch {
		return fail('public');
	}
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
export function generatePair(group: string, guild: string, user: string) {
	validateGroup(group);
	let a: bigint;
	do {
		a = BigInt('0x' + randomBytes(256).toString('hex'));
	} while (a < 1n || a >= Q);
	const publicKey = BigInt('0x' + engine(a).getPublicKey('hex')).toString();
	const nonce = randomBytes(16).toString('base64url');
	const c: Certificate = {
		guild,
		nonce,
		owner: owner(guild, user, nonce),
		expires: Date.now() + 86400_000,
		publicKey
	};
	const signed = 'DH1.' + Buffer.from(JSON.stringify(c)).toString('base64url');
	return {
		privateKey: a.toString(),
		publicKey,
		token: signed + '.' + mac(signed).toString('base64url')
	};
}
export function sharedKey(
	group: string,
	guild: string,
	user: string,
	privateKey: string,
	ownToken: string,
	peerToken: string
) {
	validateGroup(group);
	const a = validatePrivate(privateKey);
	const own = certificate(ownToken, guild);
	const peer = certificate(peerToken, guild);
	const dh = engine(a);
	if (
		own.owner !== owner(guild, user, own.nonce) ||
		own.publicKey !== BigInt('0x' + dh.getPublicKey('hex')).toString() ||
		ownToken === peerToken
	)
		return fail('public');
	// Sorting complete signed certificates binds identities, sessions and both public keys independent of direction.
	const context = JSON.stringify([
		'Mountain/DH1',
		GROUP_ID,
		guild,
		...[ownToken, peerToken].sort()
	]);
	const secret = dh.computeSecret(bytes(BigInt(peer.publicKey)));
	try {
		return {
			key: Buffer.from(
				hkdfSync(
					'sha256',
					secret,
					Buffer.alloc(32),
					createHash('sha256').update(context).digest(),
					32
				)
			).toString('base64url'),
			fingerprint: createHash('sha256').update(context).digest('hex')
		};
	} finally {
		secret.fill(0);
	}
}
