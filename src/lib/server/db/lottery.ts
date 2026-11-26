import type { TransactionSQL } from 'bun';
import { randomInt, randomUUID } from 'node:crypto';
import { getDB } from '$lib/server/db';
import { centsToMoney, moneyToCents } from '$lib/server/economy/money';
import {
	calculateLotterySettlement,
	drawLotteryNumbers,
	lotteryRank,
	LOTTERY_PRICE,
	LOTTERY_WEIGHTS,
	nextLotteryDraw,
	WEEK_MS
} from '$lib/server/economy/lottery';

export class LotteryError extends Error {}
export class LotteryIntegrityError extends LotteryError {}
export interface LotteryRound {
	guild_id: string;
	round_number: number;
	opens_at: number;
	closes_at: number;
	status: string;
	carry_in: string;
	sales: string;
	fund_before: string | null;
	winning_numbers: number[] | string | null;
	total_weight: number;
	paid: string;
	burned: string;
	carry_out: string | null;
}
export interface LotteryTicket {
	id: string;
	user_id: string;
	number: number;
	rank_number: number | null;
	weight: number;
	payout: string;
}
export function winningNumbers(round: LotteryRound): number[] {
	return typeof round.winning_numbers === 'string'
		? JSON.parse(round.winning_numbers)
		: (round.winning_numbers ?? []);
}

export async function initializeLottery(guildId: string, holderId: string, now = Date.now()) {
	const db = await getDB();
	await db.begin(async (tx) => {
		await tx`INSERT IGNORE INTO users (id, username) VALUES (${holderId}, 'Mountain')`;
		await tx`INSERT IGNORE INTO lottery_funds (guild_id, holder_id) VALUES (${guildId}, ${holderId})`;
		const funds =
			await tx`SELECT holder_id FROM lottery_funds WHERE guild_id=${guildId} FOR UPDATE`;
		if (String(funds[0].holder_id) !== holderId)
			throw new LotteryIntegrityError('복권기금 보유 봇 계정이 일치하지 않습니다.');
		await tx`INSERT IGNORE INTO accounts (guild_id, user_id) VALUES (${guildId}, ${holderId})`;
		await tx`INSERT IGNORE INTO lottery_rounds (guild_id, round_number, opens_at, closes_at)
   VALUES (${guildId}, 1, ${now}, ${nextLotteryDraw(now)})`;
	});
}

async function lockFund(tx: TransactionSQL, guildId: string) {
	const rows =
		await tx`SELECT holder_id, balance FROM lottery_funds WHERE guild_id=${guildId} FOR UPDATE`;
	if (!rows.length) throw new LotteryError('복권 시스템이 아직 준비되지 않았습니다.');
	return { holder: String(rows[0].holder_id), cents: moneyToCents(String(rows[0].balance)) };
}
async function lockAccounts(tx: TransactionSQL, guildId: string, ids: string[]) {
	for (const id of [...new Set(ids)].sort())
		await tx`INSERT IGNORE INTO accounts (guild_id, user_id) VALUES (${guildId}, ${id})`;
	const rows =
		await tx`SELECT user_id, balance FROM accounts WHERE guild_id=${guildId} AND user_id IN ${tx([...new Set(ids)].sort())} ORDER BY user_id FOR UPDATE`;
	return new Map<string, bigint>(
		rows.map((r: { user_id: string; balance: string }) => [
			String(r.user_id),
			moneyToCents(String(r.balance))
		])
	);
}
function assertFund(balance: bigint | undefined, fund: bigint) {
	if (balance === undefined || balance < fund)
		throw new LotteryIntegrityError(
			'복권기금과 봇 잔액이 불일치하여 거래를 중단했습니다. 관리자 확인이 필요합니다.'
		);
}
async function movement(
	tx: TransactionSQL,
	guild: string,
	round: number,
	type: string,
	sender: string,
	recipient: string | null,
	amount: bigint,
	before: bigint
) {
	if (amount === 0n) return null;
	const money = centsToMoney(amount);
	const ledger =
		await tx`INSERT INTO transactions (guild_id, sender_id, recipient_id, amount, transaction_type)
  VALUES (${guild}, ${sender}, ${recipient}, ${money}, ${recipient === null ? 'burn' : 'transfer'})`;
	const after = type === 'sale' ? before + amount : before - amount;
	await tx`INSERT INTO lottery_fund_movements (guild_id, round_number, transaction_id, movement_type, amount, balance_before, balance_after)
  VALUES (${guild}, ${round}, ${String(ledger.lastInsertRowid)}, ${type}, ${money}, ${centsToMoney(before)}, ${centsToMoney(after)})`;
	return String(ledger.lastInsertRowid);
}

export async function auditLotteryFund(guildId: string) {
	const db = await getDB();
	const rows = await db`SELECT f.balance AS reserved, a.balance AS actual FROM lottery_funds f
 LEFT JOIN accounts a ON a.guild_id=f.guild_id AND a.user_id=f.holder_id WHERE f.guild_id=${guildId}`;
	if (rows.length !== 1 || rows[0].actual === null)
		throw new LotteryIntegrityError('복권기금 보유 계좌가 없습니다.');
	assertFund(moneyToCents(String(rows[0].actual)), moneyToCents(String(rows[0].reserved)));
}

export async function buyLottery(
	guildId: string,
	userId: string,
	count: number,
	number?: number,
	now = Date.now()
) {
	if (
		!Number.isInteger(count) ||
		count < 1 ||
		count > 5 ||
		(number !== undefined && (!Number.isInteger(number) || number < 0 || number > 399))
	)
		throw new LotteryError('번호는 000~399, 구매 수량은 1~5장이어야 합니다.');
	const db = await getDB();
	return db.begin(async (tx) => {
		const fund = await lockFund(tx, guildId);
		if (userId === fund.holder) throw new LotteryError('복권기금 보유 봇은 구매할 수 없습니다.');
		const rounds =
			await tx`SELECT * FROM lottery_rounds WHERE guild_id=${guildId} ORDER BY round_number DESC LIMIT 1 FOR UPDATE`;
		const round = rounds[0] as LotteryRound;
		// Use wall-clock time after obtaining locks, so queued requests cannot cross the deadline.
		if (round.status !== 'open' || Number(round.closes_at) <= Math.max(now, Date.now()))
			throw new LotteryError('판매가 마감되었습니다. 추첨 정산 후 다시 구매해 주세요.');
		const existing =
			await tx`SELECT COUNT(*) AS count FROM lottery_tickets WHERE guild_id=${guildId} AND round_number=${round.round_number} AND user_id=${userId}`;
		const purchased = Number(existing[0].count);
		if (purchased + count > 5)
			throw new LotteryError(
				`회차당 최대 5장까지 구매할 수 있습니다. 현재 ${purchased}/5장입니다.`
			);
		const accounts = await lockAccounts(tx, guildId, [fund.holder, userId]);
		assertFund(accounts.get(fund.holder), fund.cents);
		const cost = LOTTERY_PRICE * BigInt(count);
		const balance = accounts.get(userId)!;
		if (balance < cost) throw new LotteryError('복권을 구매할 잔액이 부족합니다.');
		const numbers = Array.from({ length: count }, () => number ?? randomInt(400));
		await tx`UPDATE accounts SET balance=balance-${centsToMoney(cost)} WHERE guild_id=${guildId} AND user_id=${userId}`;
		await tx`UPDATE accounts SET balance=balance+${centsToMoney(cost)} WHERE guild_id=${guildId} AND user_id=${fund.holder}`;
		await tx`UPDATE lottery_funds SET balance=${centsToMoney(fund.cents + cost)} WHERE guild_id=${guildId}`;
		await movement(tx, guildId, round.round_number, 'sale', userId, fund.holder, cost, fund.cents);
		for (const value of numbers)
			await tx`INSERT INTO lottery_tickets (id, guild_id, round_number, user_id, number) VALUES (${randomUUID()}, ${guildId}, ${round.round_number}, ${userId}, ${value})`;
		await tx`UPDATE lottery_rounds SET sales=sales+${centsToMoney(cost)} WHERE guild_id=${guildId} AND round_number=${round.round_number}`;
		return {
			round: round.round_number,
			numbers,
			count: purchased + count,
			cost: centsToMoney(cost),
			balance: centsToMoney(balance - cost),
			fund: centsToMoney(fund.cents + cost),
			estimated: centsToMoney(((fund.cents + cost) * 60n) / 100n),
			closesAt: Number(round.closes_at)
		};
	});
}

// Commit the immutable draw separately, before any payout is attempted.
export async function drawDueLottery(guildId: string, now = Date.now()) {
	const db = await getDB();
	return db.begin(async (tx) => {
		await lockFund(tx, guildId);
		const rows =
			await tx`SELECT * FROM lottery_rounds WHERE guild_id=${guildId} AND status<>'settled' ORDER BY round_number LIMIT 1 FOR UPDATE`;
		const round = rows[0] as LotteryRound | undefined;
		if (!round || Number(round.closes_at) > now) return null;
		if (round.status === 'open')
			await tx`UPDATE lottery_rounds SET winning_numbers=${JSON.stringify(drawLotteryNumbers())}, status='drawn', drawn_at=CURRENT_TIMESTAMP WHERE guild_id=${guildId} AND round_number=${round.round_number} AND status='open'`;
		return Number(round.round_number);
	});
}

export async function settleLottery(guildId: string, roundNumber: number) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const fund = await lockFund(tx, guildId);
		const rows =
			await tx`SELECT * FROM lottery_rounds WHERE guild_id=${guildId} AND round_number=${roundNumber} FOR UPDATE`;
		const round = rows[0] as LotteryRound | undefined;
		if (!round || round.status === 'settled') return false;
		if (round.status !== 'drawn') throw new LotteryError('추첨 번호가 저장되지 않았습니다.');
		if (moneyToCents(String(round.carry_in)) + moneyToCents(String(round.sales)) !== fund.cents)
			throw new LotteryIntegrityError('회차 금액과 복권기금이 일치하지 않습니다.');
		const drawn = winningNumbers(round);
		if (
			drawn.length !== 17 ||
			new Set(drawn).size !== 17 ||
			drawn.some((n) => !Number.isInteger(n) || n < 0 || n > 399)
		)
			throw new LotteryIntegrityError('저장된 당첨 번호가 올바르지 않습니다.');
		const tickets =
			(await tx`SELECT * FROM lottery_tickets WHERE guild_id=${guildId} AND round_number=${roundNumber} ORDER BY user_id, id FOR UPDATE`) as LotteryTicket[];
		const weights = new Map<string, bigint>();
		for (const ticket of tickets) {
			ticket.rank_number = lotteryRank(Number(ticket.number), drawn);
			ticket.weight = ticket.rank_number ? LOTTERY_WEIGHTS[ticket.rank_number - 1] : 0;
			if (ticket.weight)
				weights.set(ticket.user_id, (weights.get(ticket.user_id) ?? 0n) + BigInt(ticket.weight));
		}
		const result = calculateLotterySettlement(fund.cents, weights);
		const accounts = await lockAccounts(tx, guildId, [fund.holder, ...weights.keys()]);
		assertFund(accounts.get(fund.holder), fund.cents);
		// Reduce the reservation first inside this transaction; the account trigger guards all other debits.
		await tx`UPDATE lottery_funds SET balance=${centsToMoney(result.carry)} WHERE guild_id=${guildId}`;
		let remaining = fund.cents;
		for (const [userId, weight] of weights) {
			const amount = result.payouts.get(userId)!;
			let transactionId: string | null = null;
			if (amount > 0n) {
				await tx`UPDATE accounts SET balance=balance-${centsToMoney(amount)} WHERE guild_id=${guildId} AND user_id=${fund.holder}`;
				await tx`UPDATE accounts SET balance=balance+${centsToMoney(amount)} WHERE guild_id=${guildId} AND user_id=${userId}`;
				transactionId = await movement(
					tx,
					guildId,
					roundNumber,
					'payout',
					fund.holder,
					userId,
					amount,
					remaining
				);
				remaining -= amount;
			}
			const winning = tickets.filter((t) => t.user_id === userId && t.weight > 0);
			// Attribute the per-user rounded payout to tickets, preserving the exact paid total.
			const ticketAmounts = winning.map((t) => (amount * BigInt(t.weight)) / weight);
			let remainder = amount - ticketAmounts.reduce((a, b) => a + b, 0n);
			for (let i = 0; remainder > 0n; i++, remainder--) ticketAmounts[i]++;
			winning.forEach((t, i) => {
				t.payout = centsToMoney(ticketAmounts[i]);
			});
			await tx`INSERT INTO lottery_payouts (guild_id, round_number, user_id, ticket_ids, weight, amount, transaction_id)
    VALUES (${guildId}, ${roundNumber}, ${userId}, ${JSON.stringify(winning.map((t) => t.id))}, ${Number(weight)}, ${centsToMoney(amount)}, ${transactionId})`;
		}
		if (result.burned > 0n) {
			await tx`UPDATE accounts SET balance=balance-${centsToMoney(result.burned)} WHERE guild_id=${guildId} AND user_id=${fund.holder}`;
			await movement(tx, guildId, roundNumber, 'burn', fund.holder, null, result.burned, remaining);
		}
		for (const ticket of tickets)
			await tx`UPDATE lottery_tickets SET rank_number=${ticket.rank_number}, weight=${ticket.weight}, payout=${ticket.payout} WHERE guild_id=${guildId} AND id=${ticket.id}`;
		await tx`UPDATE lottery_rounds SET status='settled', settled_at=CURRENT_TIMESTAMP, fund_before=${centsToMoney(fund.cents)}, total_weight=${Number(result.weight)}, paid=${centsToMoney(result.paid)}, burned=${centsToMoney(result.burned)}, carry_out=${centsToMoney(result.carry)} WHERE guild_id=${guildId} AND round_number=${roundNumber}`;
		await tx`INSERT INTO lottery_rounds (guild_id, round_number, opens_at, closes_at, carry_in) VALUES (${guildId}, ${roundNumber + 1}, ${round.closes_at}, ${Number(round.closes_at) + WEEK_MS}, ${centsToMoney(result.carry)})`;
		return true;
	});
}

export async function getLotteryStatus(guildId: string) {
	const db = await getDB();
	const rows =
		await db`SELECT r.*, f.balance AS fund, (SELECT COUNT(*) FROM lottery_tickets t WHERE t.guild_id=r.guild_id AND t.round_number=r.round_number) AS ticket_count
 FROM lottery_rounds r JOIN lottery_funds f ON f.guild_id=r.guild_id WHERE r.guild_id=${guildId} ORDER BY r.round_number DESC LIMIT 1`;
	return rows[0] as LotteryRound & { fund: string; ticket_count: number };
}
export async function getLotteryResult(guildId: string, round?: number) {
	const db = await getDB();
	const rows =
		round === undefined
			? await db`SELECT * FROM lottery_rounds WHERE guild_id=${guildId} AND status='settled' ORDER BY round_number DESC LIMIT 1`
			: await db`SELECT * FROM lottery_rounds WHERE guild_id=${guildId} AND round_number=${round} AND status='settled'`;
	if (!rows.length) return null;
	const result = rows[0] as LotteryRound;
	const counts =
		await db`SELECT rank_number, COUNT(*) AS count FROM lottery_tickets WHERE guild_id=${guildId} AND round_number=${result.round_number} AND weight>0 GROUP BY rank_number`;
	const payouts =
		await db`SELECT user_id, amount FROM lottery_payouts WHERE guild_id=${guildId} AND round_number=${result.round_number} ORDER BY user_id`;
	const winners =
		await db`SELECT user_id, rank_number, COUNT(*) AS count FROM lottery_tickets WHERE guild_id=${guildId} AND round_number=${result.round_number} AND weight>0 GROUP BY user_id, rank_number ORDER BY user_id, rank_number`;
	return {
		round: result,
		counts: counts as { rank_number: number; count: number }[],
		payouts: payouts as { user_id: string; amount: string }[],
		winners: winners as { user_id: string; rank_number: number; count: number }[]
	};
}
export async function getLotteryTickets(guildId: string, userId: string, round?: number) {
	const db = await getDB();
	const current = round ?? Number((await getLotteryStatus(guildId)).round_number);
	const rows =
		await db`SELECT t.*, r.status FROM lottery_tickets t JOIN lottery_rounds r ON r.guild_id=t.guild_id AND r.round_number=t.round_number WHERE t.guild_id=${guildId} AND t.round_number=${current} AND t.user_id=${userId} ORDER BY t.purchased_at, t.id`;
	return { round: current, tickets: rows as (LotteryTicket & { status: string })[] };
}
