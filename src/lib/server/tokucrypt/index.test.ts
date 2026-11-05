import { afterAll, beforeEach, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { transform } from './index';
const originalKeys = process.env.TOKUCRYPT_KEYS;
const originalId = process.env.TOKUCRYPT_ACTIVE_KEY_ID;
const old = randomBytes(32).toString('hex');
let sequence = 0;
const run = (
	mode: 'encrypt' | 'decrypt',
	text: string,
	password = ' 비밀번호 🔑 ',
	guild = '123456789'
) => transform(mode, guild, `test-${sequence++}`, text, password);
beforeEach(() => {
	process.env.TOKUCRYPT_KEYS = JSON.stringify({ v1: old });
	process.env.TOKUCRYPT_ACTIVE_KEY_ID = 'v1';
});
afterAll(() => {
	if (originalKeys === undefined) delete process.env.TOKUCRYPT_KEYS;
	else process.env.TOKUCRYPT_KEYS = originalKeys;
	if (originalId === undefined) delete process.env.TOKUCRYPT_ACTIVE_KEY_ID;
	else process.env.TOKUCRYPT_ACTIVE_KEY_ID = originalId;
});
test('Unicode, whitespace, randomness and persisted key roundtrip', async () => {
	const plain = '  한글 English 123 !`@😚\n\n끝  ';
	const first = await run('encrypt', plain);
	const second = await run('encrypt', plain);
	expect(first).not.toBe(second);
	expect(await run('decrypt', first)).toBe(plain);
	process.env.TOKUCRYPT_KEYS = JSON.stringify({ v1: old });
	expect(await run('decrypt', first)).toBe(plain);
});
test('rejects wrong password, guild, key, tag and authenticated metadata', async () => {
	const ciphertext = await run('encrypt', 'secret');
	await expect(run('decrypt', ciphertext, 'wrong')).rejects.toMatchObject({ code: 'auth' });
	await expect(run('decrypt', ciphertext, undefined, '987654321')).rejects.toMatchObject({
		code: 'auth'
	});
	for (const offset of [1, 25, 31, 47, 59, 80]) {
		const bytes = Buffer.from(ciphertext.slice(4), 'base64url');
		bytes[Math.min(offset, bytes.length - 1)] ^= 1;
		await expect(run('decrypt', 'TK1.' + bytes.toString('base64url'))).rejects.toBeDefined();
	}
	process.env.TOKUCRYPT_KEYS = JSON.stringify({ v1: randomBytes(32).toString('hex') });
	await expect(run('decrypt', ciphertext)).rejects.toMatchObject({ code: 'auth' });
});
test('rotation preserves previous keys', async () => {
	const ciphertext = await run('encrypt', 'old');
	process.env.TOKUCRYPT_KEYS = JSON.stringify({ v1: old, v2: randomBytes(32).toString('hex') });
	process.env.TOKUCRYPT_ACTIVE_KEY_ID = 'v2';
	expect(await run('decrypt', ciphertext)).toBe('old');
	expect(await run('decrypt', await run('encrypt', 'new'))).toBe('new');
});
test('format, version, configuration and size limits', async () => {
	await expect(run('decrypt', 'TK2.abc')).rejects.toMatchObject({ code: 'version' });
	await expect(run('decrypt', 'not ciphertext')).rejects.toMatchObject({ code: 'format' });
	await expect(run('encrypt', 'x', '')).rejects.toMatchObject({ code: 'input' });
	await expect(run('encrypt', '한'.repeat(1000))).rejects.toMatchObject({ code: 'input' });
	const longest = await run('encrypt', 'x'.repeat(2800));
	expect(longest.length).toBeLessThanOrEqual(4000);
	expect(await run('decrypt', longest)).toBe('x'.repeat(2800));
	delete process.env.TOKUCRYPT_KEYS;
	await expect(run('encrypt', 'x')).rejects.toMatchObject({ code: 'config' });
});
test('per-user and global concurrency limits', async () => {
	for (let i = 0; i < 5; i++) await transform('encrypt', '123', 'limited', 'x', 'p');
	await expect(transform('encrypt', '123', 'limited', 'x', 'p')).rejects.toMatchObject({
		code: 'limit'
	});
	const first = run('encrypt', 'a');
	const second = run('encrypt', 'b');
	await expect(run('encrypt', 'c')).rejects.toMatchObject({ code: 'limit' });
	await Promise.all([first, second]);
});
