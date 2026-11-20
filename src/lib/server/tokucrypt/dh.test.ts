import { expect, test } from 'bun:test';
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
	validatePublic,
	validateParameters,
	parameterEnvironment
} from './dh';
import { transform } from './index';
const pair = () => generatePair(GROUP_ID);

test('pinned safe prime and subgroup generator', () => {
	expect(PRIME_HEX.length).toBe(512);
	expect(checkPrimeSync(Buffer.from(PRIME_HEX, 'hex'), { checks: 32 })).toBe(true);
	expect(checkPrimeSync(Buffer.from(Q.toString(16), 'hex'), { checks: 32 })).toBe(true);
	expect(validatePublic('2')).toBe(2n);
});
test('independent keys, symmetric canonical HKDF and existing cipher compatibility', async () => {
	const a = pair(),
		b = pair();
	expect(a.privateKey).not.toBe(b.privateKey);
	expect(a.publicKey).not.toBe(b.publicKey);
	const left = sharedKey(GROUP_ID, '123', a.privateKey, b.publicKey);
	const right = sharedKey(GROUP_ID, '123', b.privateKey, a.publicKey);
	expect(left).toEqual(right);
	expect(left.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
	expect(a.publicKey.length + a.privateKey.length + 230).toBeLessThan(2000);
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
test('canonical numeric public keys and transcript binding', () => {
	const a = pair(),
		b = pair(),
		c = pair();
	const left = sharedKey(GROUP_ID, '123', a.privateKey, b.publicKey);
	expect(sharedKey(GROUP_ID, '123', a.privateKey, '0002')).toEqual(
		sharedKey(GROUP_ID, '123', a.privateKey, '2')
	);
	expect(sharedKey(GROUP_ID, '456', a.privateKey, b.publicKey).key).not.toBe(left.key);
	expect(sharedKey(GROUP_ID, '123', a.privateKey, c.publicKey).key).not.toBe(left.key);
	expect(() => sharedKey(GROUP_ID, '123', a.privateKey, a.publicKey)).toThrow('public');
});
test('environment only accepts the pinned standard pair and exports copyable values', () => {
	const oldP = process.env.DH_P,
		oldQ = process.env.DH_Q;
	try {
		delete process.env.DH_P;
		delete process.env.DH_Q;
		expect(() => validateParameters()).not.toThrow();
		process.env.DH_P = P.toString();
		process.env.DH_Q = Q.toString();
		expect(() => validateParameters()).not.toThrow();
		expect(parameterEnvironment()).toBe(`DH_P=${P}\nDH_Q=${Q}\n`);
		process.env.DH_Q = '11';
		expect(() => validateParameters()).toThrow('config');
		process.env.DH_Q = Q.toString();
		process.env.DH_P = '23';
		expect(() => generatePair(GROUP_ID)).toThrow('config');
		delete process.env.DH_P;
		expect(() => validateParameters()).toThrow('config');
	} finally {
		if (oldP === undefined) delete process.env.DH_P;
		else process.env.DH_P = oldP;
		if (oldQ === undefined) delete process.env.DH_Q;
		else process.env.DH_Q = oldQ;
	}
});
