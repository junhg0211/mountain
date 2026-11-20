import { expect, test } from 'bun:test';
import { createHash, hkdfSync } from 'node:crypto';
import { GROUP_ID, generatePair, sharedKey } from './dh';
import { transform } from './index';
const b64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64url');

test('independent 43-character keys, symmetric HKDF and existing cipher compatibility', async () => {
	const a = generatePair(),
		b = generatePair();
	for (const key of [a.privateKey, a.publicKey, b.privateKey, b.publicKey])
		expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
	expect(a.privateKey).not.toBe(b.privateKey);
	expect(a.publicKey).not.toBe(b.publicKey);
	const left = sharedKey('123', a.privateKey, b.publicKey);
	const right = sharedKey('123', b.privateKey, a.publicKey);
	expect(left).toEqual(right);
	expect(left.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
	const keys = process.env.TOKUCRYPT_KEYS,
		id = process.env.TOKUCRYPT_ACTIVE_KEY_ID;
	try {
		process.env.TOKUCRYPT_KEYS = JSON.stringify({ dhTest: 'cd'.repeat(32) });
		process.env.TOKUCRYPT_ACTIVE_KEY_ID = 'dhTest';
		const cipher = await transform('encrypt', '123', 'dh-a', '선택적 신원 공개', left.key);
		expect(await transform('decrypt', '123', 'dh-b', cipher, right.key)).toBe('선택적 신원 공개');
	} finally {
		if (keys === undefined) delete process.env.TOKUCRYPT_KEYS;
		else process.env.TOKUCRYPT_KEYS = keys;
		if (id === undefined) delete process.env.TOKUCRYPT_ACTIVE_KEY_ID;
		else process.env.TOKUCRYPT_ACTIVE_KEY_ID = id;
	}
});
test('RFC 7748 section 6.1 vector and versioned transcript derivation', () => {
	const a = b64('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
	const A = b64('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
	const b = b64('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
	const B = b64('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');
	const secret = Buffer.from(
		'4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742',
		'hex'
	);
	const context = JSON.stringify(['Mountain/DH3', GROUP_ID, '123', ...[A, B].sort()]);
	const hash = createHash('sha256').update(context).digest();
	const expected = {
		key: Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(32), hash, 32)).toString('base64url')
	};
	expect(sharedKey('123', a, B)).toEqual(expected);
	expect(sharedKey('123', b, A)).toEqual(expected);
});
test('malformed, oversized, padded and noncanonical base64 inputs rejected', () => {
	const a = generatePair(),
		b = generatePair();
	for (const value of [
		'',
		'1'.repeat(617),
		'x'.repeat(100000),
		a.privateKey + '=',
		' ' + a.privateKey,
		'!'.repeat(43)
	]) {
		expect(() => sharedKey('123', value, b.publicKey)).toThrow('format');
		expect(() => sharedKey('123', a.privateKey, value)).toThrow('format');
	}
	// A 32-byte value encodes with two unused trailing bits; reject alternative spellings.
	const canonical = Buffer.alloc(32).toString('base64url');
	expect(() => sharedKey('123', a.privateKey, canonical.slice(0, -1) + 'B')).toThrow('format');
});
test('low-order, noncanonical field elements, reflected keys and transcript substitution rejected', () => {
	const a = generatePair(),
		b = generatePair(),
		c = generatePair();
	for (const raw of [
		Buffer.alloc(32),
		Buffer.from('01' + '00'.repeat(31), 'hex'),
		Buffer.from('ed' + 'ff'.repeat(30) + '7f', 'hex'),
		Buffer.alloc(32, 255)
	])
		expect(() => sharedKey('123', a.privateKey, raw.toString('base64url'))).toThrow('public');
	expect(() => sharedKey('123', a.privateKey, a.publicKey)).toThrow('public');
	const left = sharedKey('123', a.privateKey, b.publicKey);
	expect(sharedKey('456', a.privateKey, b.publicKey).key).not.toBe(left.key);
	expect(sharedKey('123', a.privateKey, c.publicKey).key).not.toBe(left.key);
});
