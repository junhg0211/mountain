import { describe, expect, test } from 'bun:test';
import {
	calculateLotterySettlement,
	drawLotteryNumbers,
	lotteryRank,
	nextLotteryDraw,
	WEEK_MS
} from './lottery';

describe('weekly Korean lottery schedule', () => {
	test('Friday night closes at Saturday 09:00 KST', () => {
		expect(nextLotteryDraw(Date.parse('2026-11-27T23:59:59+09:00'))).toBe(
			Date.parse('2026-11-28T09:00:00+09:00')
		);
	});
	test('exact deadline advances to the next week', () => {
		const deadline = Date.parse('2026-11-28T09:00:00+09:00');
		expect(nextLotteryDraw(deadline - 1)).toBe(deadline);
		expect(nextLotteryDraw(deadline)).toBe(deadline + WEEK_MS);
	});
});
describe('lottery settlement', () => {
	test('normal winners preserve the bot general funds', () => {
		const r = calculateLotterySettlement(
			800n,
			new Map([
				['A', 5n],
				['B', 3n]
			])
		);
		expect(r.payouts).toEqual(
			new Map([
				['A', 300n],
				['B', 180n]
			])
		);
		expect([r.paid, r.burned, r.carry]).toEqual([480n, 80n, 240n]);
		expect(10800n - r.paid - r.burned - r.carry).toBe(10000n);
	});
	test('no winner and no sales still burn ten percent of carry-in', () => {
		expect(calculateLotterySettlement(800n, new Map())).toMatchObject({
			paid: 0n,
			burned: 80n,
			carry: 720n
		});
		expect(calculateLotterySettlement(0n, new Map())).toMatchObject({
			paid: 0n,
			burned: 0n,
			carry: 0n
		});
	});
	test('duplicate tickets count independently', () => {
		expect(calculateLotterySettlement(500n, new Map([['A', 25n]])).payouts.get('A')).toBe(300n);
	});
	test('only final user payouts are floored, not the pool or unit weight', () => {
		const r = calculateLotterySettlement(
			103n,
			new Map([
				['A', 5n],
				['B', 1n]
			])
		);
		expect(r.payouts).toEqual(
			new Map([
				['A', 51n],
				['B', 10n]
			])
		);
		expect(r.carry).toBe(32n);
	});
	test('fractional cents are carried rather than distributed', () => {
		const r = calculateLotterySettlement(
			101n,
			new Map([
				['A', 1n],
				['B', 1n],
				['C', 5n]
			])
		);
		expect([...r.payouts.values()]).toEqual([8n, 8n, 43n]);
		expect(r.carry).toBe(32n);
	});
	test('conserves every cent across small funds and weight distributions', () => {
		for (let fund = 0n; fund < 1000n; fund++) {
			for (const weights of [
				new Map<string, bigint>(),
				new Map([['a', 1n]]),
				new Map([
					['a', 25n],
					['b', 3n],
					['c', 5n]
				])
			]) {
				const r = calculateLotterySettlement(fund, weights);
				expect(r.paid + r.burned + r.carry).toBe(fund);
				expect(r.carry >= 0n).toBe(true);
				expect(r.paid * 100n <= fund * 60n).toBe(true);
			}
		}
	});
});
test('draw has exactly 2 first, 5 second, 10 third and 383 losing numbers', () => {
	for (let attempt = 0; attempt < 100; attempt++) {
		const drawn = drawLotteryNumbers();
		expect(drawn.length).toBe(17);
		expect(new Set(drawn).size).toBe(17);
		const counts = [0, 0, 0, 0];
		for (let n = 0; n < 400; n++) counts[lotteryRank(n, drawn) ?? 0]++;
		expect(counts).toEqual([383, 2, 5, 10]);
	}
});
