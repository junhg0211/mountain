import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { getDB, closeDB } from '$lib/server/db';
import {
	buyLottery,
	drawDueLottery,
	getLotteryResult,
	getLotteryTickets,
	initializeLottery,
	settleLottery,
	winningNumbers
} from './lottery';
import { adjustBalance, transferBalance } from './accounts';

// Opt in against an isolated schema: never run monetary integration fixtures in production.
const enabled = process.env.RUN_LOTTERY_DB_TESTS === '1';
const integration = enabled ? test : test.skip;
integration(
	'atomic purchases, fund guard, persisted draw and idempotent settlement',
	async () => {
		if (!process.env.DB_NAME?.startsWith('mountain_lottery_test'))
			throw new Error('Use a DB_NAME beginning with mountain_lottery_test.');
		const db = await getDB();
		const guild = `lottery-test-${randomUUID()}`;
		const otherGuild = `other-${guild}`;
		const bot = `bot-${randomUUID()}`,
			a = `a-${randomUUID()}`,
			b = `b-${randomUUID()}`;
		try {
			for (const id of [bot, a, b])
				await db`INSERT INTO users (id, username) VALUES (${id}, ${id})`;
			await initializeLottery(guild, bot);
			await initializeLottery(otherGuild, bot);
			await adjustBalance(guild, bot, '100.00', 'mint');
			for (const id of [a, b]) await adjustBalance(guild, id, '20.00', 'mint');
			const raced = await Promise.allSettled(
				Array.from({ length: 6 }, () => buyLottery(guild, a, 1, 42))
			);
			expect(raced.filter((r) => r.status === 'fulfilled').length).toBe(5);
			await buyLottery(guild, b, 3, 123);
			const funds = await db`SELECT balance FROM lottery_funds WHERE guild_id=${guild}`;
			expect(String(funds[0].balance)).toBe('8.00');
			expect((await getLotteryTickets(otherGuild, a)).tickets.length).toBe(0);
			await expect(transferBalance(guild, bot, b, '101.00')).rejects.toThrow();
			await transferBalance(guild, bot, b, '100.00');
			await expect(adjustBalance(guild, bot, '0.01', 'burn')).rejects.toThrow();
			await transferBalance(guild, b, bot, '100.00');
			// The forced fixture is past its deadline, so late sales must fail even before drawing.
			await db`UPDATE lottery_rounds SET closes_at=${Date.now() - 1} WHERE guild_id=${guild} AND round_number=1`;
			await expect(buyLottery(guild, b, 1)).rejects.toThrow();
			expect(await drawDueLottery(guild)).toBe(1);
			const before =
				await db`SELECT winning_numbers FROM lottery_rounds WHERE guild_id=${guild} AND round_number=1`;
			await drawDueLottery(guild);
			const after =
				await db`SELECT winning_numbers FROM lottery_rounds WHERE guild_id=${guild} AND round_number=1`;
			expect(after[0].winning_numbers).toEqual(before[0].winning_numbers);
			// Deterministic rank fixtures after validating persisted, non-repeating real draws.
			const draw = [
				42, 399, 123, 398, 397, 396, 395, 394, 393, 392, 391, 390, 389, 388, 387, 386, 385
			];
			await db`UPDATE lottery_rounds SET winning_numbers=${JSON.stringify(draw)} WHERE guild_id=${guild} AND round_number=1`;
			const settlements = await Promise.all([settleLottery(guild, 1), settleLottery(guild, 1)]);
			expect(settlements.filter(Boolean).length).toBe(1);
			const result = (await getLotteryResult(guild, 1))!;
			expect(winningNumbers(result.round)).toEqual(draw);
			expect(String(result.round.paid)).toBe('4.79');
			expect(String(result.round.burned)).toBe('0.80');
			expect(String(result.round.carry_out)).toBe('2.41');
			const holder =
				await db`SELECT balance FROM accounts WHERE guild_id=${guild} AND user_id=${bot}`;
			expect(String(holder[0].balance)).toBe('102.41');
			const movements =
				await db`SELECT m.transaction_id FROM lottery_fund_movements m LEFT JOIN transactions t ON t.id=m.transaction_id AND t.guild_id=m.guild_id WHERE m.guild_id=${guild} AND t.id IS NULL`;
			expect(movements.length).toBe(0);
			const tickets = await getLotteryTickets(guild, a, 1);
			expect(tickets.tickets.every((t) => Number(t.rank_number) === 1)).toBe(true);
			// No-ticket rounds consume carry-in without minting, and can be caught up in order.
			await db`UPDATE lottery_rounds SET closes_at=${Date.now() - 1} WHERE guild_id=${guild} AND round_number=2`;
			await drawDueLottery(guild);
			await settleLottery(guild, 2);
			const empty = (await getLotteryResult(guild, 2))!.round;
			expect([String(empty.paid), String(empty.burned), String(empty.carry_out)]).toEqual([
				'0.00',
				'0.24',
				'2.17'
			]);
		} finally {
			for (const g of [guild, otherGuild]) {
				await db`DELETE FROM lottery_announcements WHERE guild_id=${g}`;
				await db`DELETE FROM lottery_payouts WHERE guild_id=${g}`;
				await db`DELETE FROM lottery_fund_movements WHERE guild_id=${g}`;
				await db`DELETE FROM lottery_tickets WHERE guild_id=${g}`;
				await db`DELETE FROM lottery_rounds WHERE guild_id=${g}`;
				await db`DELETE FROM lottery_funds WHERE guild_id=${g}`;
				await db`DELETE FROM transactions WHERE guild_id=${g}`;
				await db`DELETE FROM accounts WHERE guild_id=${g}`;
			}
			for (const id of [bot, a, b]) await db`DELETE FROM users WHERE id=${id}`;
			await closeDB();
		}
	},
	30000
);
