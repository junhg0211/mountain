import { randomInt } from 'node:crypto';

export const LOTTERY_PRICE = 100n;
export const LOTTERY_LIMIT = 5;
export const LOTTERY_WEIGHTS = [5, 2, 1] as const;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Saturday 09:00 KST is Saturday 00:00 UTC.
export function nextLotteryDraw(now = Date.now()): number {
	const date = new Date(now);
	const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
	const candidate = midnight + ((6 - date.getUTCDay() + 7) % 7) * 86400000;
	return candidate > now ? candidate : candidate + WEEK_MS;
}

export function drawLotteryNumbers(): number[] {
	const numbers = Array.from({ length: 400 }, (_, i) => i);
	for (let i = 0; i < 17; i++) {
		const j = randomInt(i, 400);
		[numbers[i], numbers[j]] = [numbers[j], numbers[i]];
	}
	return numbers.slice(0, 17);
}

export function lotteryRank(number: number, drawn: number[]): number | null {
	const index = drawn.indexOf(number);
	return index < 0 ? null : index < 2 ? 1 : index < 7 ? 2 : 3;
}

export function calculateLotterySettlement(fund: bigint, weights: Map<string, bigint>) {
	if (fund < 0n || [...weights.values()].some((w) => w <= 0n))
		throw new RangeError('Invalid lottery amounts.');
	const weight = [...weights.values()].reduce((a, b) => a + b, 0n);
	const payouts = new Map<string, bigint>();
	// Do not truncate the 60% pool or unit weight before the final per-user division.
	for (const [user, w] of weights) payouts.set(user, (fund * 60n * w) / (100n * weight));
	const paid = [...payouts.values()].reduce((a, b) => a + b, 0n);
	const burned = fund / 10n;
	return { weight, payouts, paid, burned, carry: fund - paid - burned };
}

export function lotteryNumber(number: number): string {
	return String(number).padStart(3, '0');
}
