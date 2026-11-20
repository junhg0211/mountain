import { afterAll, expect, test } from 'bun:test';
import { checkPrimeSync } from 'node:crypto';
import {
	GROUP_ID,
	P,
	Q,
	PRIME_HEX,
	generatePair,
	sharedKey,
	validateGroup,
	validatePrivate,
	validatePublic
} from './dh';
import { transform } from './index';
const original = process.env.DH_SIGNING_KEY;
process.env.DH_SIGNING_KEY = 'ab'.repeat(32);
afterAll(() => {
	if (original === undefined) delete process.env.DH_SIGNING_KEY;
	else process.env.DH_SIGNING_KEY = original;
});
const pair = (user: string) => generatePair(GROUP_ID, '123', user);

test('pinned safe prime and subgroup generator', () => {
	expect(PRIME_HEX.length).toBe(512);
	expect(checkPrimeSync(Buffer.from(PRIME_HEX, 'hex'), { checks: 32 })).toBe(true);
	expect(checkPrimeSync(Buffer.from(Q.toString(16), 'hex'), { checks: 32 })).toBe(true);
	expect(validatePublic('2')).toBe(2n);
});
test('independent keys, symmetric canonical HKDF and existing cipher compatibility', async () => {
	const a = pair('a'),
		b = pair('b');
	expect(a.privateKey).not.toBe(b.privateKey);
	expect(a.publicKey).not.toBe(b.publicKey);
	const left = sharedKey(GROUP_ID, '123', 'a', a.privateKey, a.token, b.token);
	const right = sharedKey(GROUP_ID, '123', 'b', b.privateKey, b.token, a.token);
	expect(left).toEqual(right);
	expect(left.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
	expect(a.token.length + a.privateKey.length + 230).toBeLessThan(2000);
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
test('range, subgroup, format and unsupported group rejection', () => {
	for (const value of ['0', Q.toString(), P.toString()])
		expect(() => validatePrivate(value)).toThrow('private');
	for (const value of ['0', '1', (P - 1n).toString(), P.toString(), (P - 2n).toString()])
		expect(() => validatePublic(value)).toThrow('public');
	for (const value of ['-1', '1.5', '0x10', '1'.repeat(100000)])
		expect(() => validatePrivate(value)).toThrow('format');
	expect(() => validateGroup('modp14')).toThrow('group');
});
test('signed ownership, guild, private/public match and transcript binding', () => {
	const a = pair('a'),
		b = pair('b'),
		c = pair('c');
	expect(() => sharedKey(GROUP_ID, '123', 'c', a.privateKey, a.token, b.token)).toThrow('public');
	expect(() => sharedKey(GROUP_ID, '456', 'a', a.privateKey, a.token, b.token)).toThrow('public');
	expect(() => sharedKey(GROUP_ID, '123', 'a', b.privateKey, a.token, b.token)).toThrow('public');
	expect(() =>
		sharedKey(GROUP_ID, '123', 'a', a.privateKey, a.token, b.token.slice(0, -2) + 'aa')
	).toThrow();
	expect(sharedKey(GROUP_ID, '123', 'a', a.privateKey, a.token, b.token).key).not.toBe(
		sharedKey(GROUP_ID, '123', 'a', a.privateKey, a.token, c.token).key
	);
	const now = Date.now;
	try {
		Date.now = () => now() + 86400_001;
		expect(() => sharedKey(GROUP_ID, '123', 'a', a.privateKey, a.token, b.token)).toThrow('public');
	} finally {
		Date.now = now;
	}
});
