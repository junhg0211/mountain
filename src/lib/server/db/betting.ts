import { getDB } from '$lib/server/db';
import { getGuildDisplayNames } from '$lib/server/discord/users';
import { centsToMoney, moneyToCents } from '$lib/server/economy/money';
import { InsufficientBalanceError } from './accounts';

export type BettingPoolStatus = 'open' | 'settled' | 'refunded' | 'archived';

export interface BettingPool {
	id: string;
	guildId: string;
	ownerId: string;
	ownerName: string;
	title: string;
	bettingMode: 'legacy' | 'team';
	status: BettingPoolStatus;
	winnerId: string | null;
	winnerName: string | null;
	winningOption: 'A' | 'B' | null;
	totalAmount: string;
	houseBalance: string;
	optionTotals: { A: string; B: string };
	participantCount: number;
	createdAt: string;
	closedAt: string | null;
	participants: Array<{
		userId: string;
		username: string;
		amount: string;
		optionKey: 'A' | 'B' | null;
	}>;
}

export class BettingPoolNotFoundError extends Error {}
export class BettingPoolClosedError extends Error {}
export class BettingPermissionError extends Error {}
export class BettingParticipantError extends Error {}
export class BettingOptionError extends Error {}
export class BettingWeightError extends Error {}

type PoolRow = Record<string, unknown>;

function formatMoney(value: unknown): string {
	const [integer, fraction = ''] = String(value).split('.');
	return `${integer}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

function iso(value: unknown): string {
	return new Date(value as string | number | Date).toISOString();
}

async function mapPools(rows: PoolRow[]): Promise<BettingPool[]> {
	const db = await getDB();
	return Promise.all(
		rows.map(async (row) => {
			const entries = await db`
				SELECT roster.user_id, COALESCE(betting_entries.amount, 0.00) AS amount,
					betting_entries.option_key, users.username
				FROM (
					SELECT user_id FROM betting_pool_members WHERE pool_id=${String(row.id)}
					UNION SELECT user_id FROM betting_entries WHERE pool_id=${String(row.id)}
				) roster
				LEFT JOIN betting_entries ON betting_entries.pool_id=${String(row.id)}
					AND betting_entries.user_id=roster.user_id
				LEFT JOIN users ON users.id=roster.user_id
				ORDER BY betting_entries.amount IS NULL, betting_entries.amount DESC
			`;
			return {
				id: String(row.id),
				guildId: String(row.guild_id),
				ownerId: String(row.owner_id),
				ownerName: String(row.owner_name || '알 수 없는 사용자'),
				title: String(row.title),
				status: String(row.status) as BettingPoolStatus,
				bettingMode: String(row.betting_mode) === 'team' ? 'team' : 'legacy',
				winnerId: row.winner_id ? String(row.winner_id) : null,
				winnerName: row.winner_name ? String(row.winner_name) : null,
				winningOption:
					row.winning_option === 'A' || row.winning_option === 'B' ? row.winning_option : null,
				totalAmount: formatMoney(row.total_amount || 0),
				houseBalance: formatMoney(row.house_balance || 0),
				optionTotals: {
					A: formatMoney(row.option_a_total || 0),
					B: formatMoney(row.option_b_total || 0)
				},
				participantCount: entries.length,
				createdAt: iso(row.created_at),
				closedAt: row.closed_at ? iso(row.closed_at) : null,
				participants: entries.map((entry: PoolRow) => ({
					userId: String(entry.user_id),
					username: String(entry.username || '알 수 없는 사용자'),
					amount: formatMoney(entry.amount),
					optionKey: entry.option_key === 'A' || entry.option_key === 'B' ? entry.option_key : null
				}))
			};
		})
	);
}

async function applyGuildDisplayNames(guildId: string, pools: BettingPool[]) {
	const userIds = pools.flatMap((pool) => [
		pool.ownerId,
		...(pool.winnerId ? [pool.winnerId] : []),
		...pool.participants.map((participant) => participant.userId)
	]);
	const names = await getGuildDisplayNames(guildId, userIds);
	return pools.map((pool) => ({
		...pool,
		ownerName: names.get(pool.ownerId) || pool.ownerName,
		winnerName: pool.winnerId ? names.get(pool.winnerId) || pool.winnerName : null,
		participants: pool.participants.map((participant) => ({
			...participant,
			username: names.get(participant.userId) || participant.username
		}))
	}));
}

const poolSelect = `
	SELECT betting_pools.*,
		owner.username AS owner_name, winner.username AS winner_name,
		COALESCE(SUM(betting_entries.amount), 0.00) AS total_amount,
		COALESCE(SUM(CASE WHEN betting_entries.option_key = 'A' THEN betting_entries.amount ELSE 0 END), 0.00) AS option_a_total,
		COALESCE(SUM(CASE WHEN betting_entries.option_key = 'B' THEN betting_entries.amount ELSE 0 END), 0.00) AS option_b_total,
		COUNT(betting_entries.user_id) AS participant_count
	FROM betting_pools
	LEFT JOIN users owner ON owner.id = betting_pools.owner_id
	LEFT JOIN users winner ON winner.id = betting_pools.winner_id
	LEFT JOIN betting_entries ON betting_entries.pool_id = betting_pools.id
`;

export async function getBettingPools(guildId: string, limit = 10) {
	const db = await getDB();
	const rows = await db.unsafe(
		`${poolSelect}
		 WHERE betting_pools.guild_id = ? AND betting_pools.status <> 'archived'
		 GROUP BY betting_pools.id
		 ORDER BY (betting_pools.status = 'open') DESC, betting_pools.created_at DESC
		 LIMIT ?`,
		[guildId, limit]
	);
	return applyGuildDisplayNames(guildId, await mapPools(rows as PoolRow[]));
}

export async function getBettingPool(guildId: string, poolId: string) {
	const db = await getDB();
	const rows = await db.unsafe(
		`${poolSelect}
		 WHERE betting_pools.guild_id = ? AND betting_pools.id = ?
		 GROUP BY betting_pools.id LIMIT 1`,
		[guildId, poolId]
	);
	const pools = await applyGuildDisplayNames(guildId, await mapPools(rows as PoolRow[]));
	return pools[0] || null;
}

export async function createBettingPool(guildId: string, ownerId: string, title: string) {
	const db = await getDB();
	const result = await db`
		INSERT INTO betting_pools (guild_id, owner_id, title)
		VALUES (${guildId}, ${ownerId}, ${title})
	`;
	return String(result.lastInsertRowid);
}

export async function createTeamBettingPool(guildId: string, ownerId: string, title: string) {
	const db = await getDB();
	const result = await db.begin(async (tx) => {
		const inserted = await tx`
			INSERT INTO betting_pools (guild_id, owner_id, title, betting_mode)
			VALUES (${guildId}, ${ownerId}, ${title}, 'team')
		`;
		const poolId = String(inserted.lastInsertRowid);
		await tx`
			INSERT INTO betting_events (pool_id, event_type, user_id)
			VALUES (${poolId}, 'created', ${ownerId})
		`;
		return poolId;
	});
	return result;
}

export async function placeTeamBet(
	guildId: string,
	poolId: string,
	userId: string,
	optionKey: 'A' | 'B',
	amount: string
) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const pools = await tx`
			SELECT status, betting_mode FROM betting_pools
			WHERE id=${poolId} AND guild_id=${guildId} FOR UPDATE
		`;
		if (pools.length !== 1) throw new BettingPoolNotFoundError();
		if (String(pools[0].status) !== 'open') throw new BettingPoolClosedError();
		if (String(pools[0].betting_mode) !== 'team') throw new BettingOptionError();
		const existing = await tx`
			SELECT option_key FROM betting_entries WHERE pool_id=${poolId} AND user_id=${userId} FOR UPDATE
		`;
		if (existing.length && String(existing[0].option_key) !== optionKey)
			throw new BettingOptionError();
		await tx`INSERT IGNORE INTO accounts (guild_id, user_id) VALUES (${guildId}, ${userId})`;
		const accounts = await tx`
			SELECT balance FROM accounts WHERE guild_id=${guildId} AND user_id=${userId} FOR UPDATE
		`;
		const balance = moneyToCents(formatMoney(accounts[0]?.balance || 0));
		const stake = moneyToCents(amount);
		if (balance < stake) throw new InsufficientBalanceError();
		await tx`UPDATE accounts SET balance=balance-${amount} WHERE guild_id=${guildId} AND user_id=${userId}`;
		await tx`INSERT IGNORE INTO betting_pool_members (pool_id,user_id) VALUES (${poolId},${userId})`;
		await tx`
			INSERT INTO betting_entries (pool_id, user_id, option_key, amount)
			VALUES (${poolId}, ${userId}, ${optionKey}, ${amount})
			ON DUPLICATE KEY UPDATE amount=amount+VALUES(amount)
		`;
		await tx`
			INSERT INTO transactions
				(guild_id, sender_id, recipient_id, amount, transaction_type, betting_pool_id)
			VALUES (${guildId}, ${userId}, ${null}, ${amount}, 'bet_stake', ${poolId})
		`;
		await tx`
			INSERT INTO betting_events (pool_id, event_type, user_id, option_key, amount)
			VALUES (${poolId}, 'stake', ${userId}, ${optionKey}, ${amount})
		`;
		return centsToMoney(balance - stake);
	});
}

export async function placeBet(guildId: string, poolId: string, userId: string, amount: string) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const pools = await tx`
			SELECT id, status FROM betting_pools
			WHERE id=${poolId} AND guild_id=${guildId} FOR UPDATE
		`;
		if (pools.length !== 1) throw new BettingPoolNotFoundError();
		if (String(pools[0].status) !== 'open') throw new BettingPoolClosedError();

		await tx`INSERT IGNORE INTO accounts (guild_id, user_id) VALUES (${guildId}, ${userId})`;
		const accounts = await tx`
			SELECT balance FROM accounts WHERE guild_id=${guildId} AND user_id=${userId} FOR UPDATE
		`;
		const balance = moneyToCents(formatMoney(accounts[0]?.balance || 0));
		const stake = moneyToCents(amount);
		if (balance < stake) throw new InsufficientBalanceError();

		await tx`
			UPDATE accounts SET balance=balance-${amount}
			WHERE guild_id=${guildId} AND user_id=${userId}
		`;
		await tx`INSERT IGNORE INTO betting_pool_members (pool_id,user_id) VALUES (${poolId},${userId})`;
		await tx`
			INSERT INTO betting_entries (pool_id, user_id, amount)
			VALUES (${poolId}, ${userId}, ${amount})
			ON DUPLICATE KEY UPDATE amount=amount+VALUES(amount)
		`;
		await tx`
			INSERT INTO transactions
				(guild_id, sender_id, recipient_id, amount, transaction_type, betting_pool_id)
			VALUES (${guildId}, ${userId}, ${null}, ${amount}, 'bet_stake', ${poolId})
		`;
		return centsToMoney(balance - stake);
	});
}

export async function settleBettingPool(
	guildId: string,
	poolId: string,
	actorId: string,
	winnerId: string,
	canOverride = false
) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const pools = await tx`
			SELECT owner_id, status FROM betting_pools
			WHERE id=${poolId} AND guild_id=${guildId} FOR UPDATE
		`;
		if (pools.length !== 1) throw new BettingPoolNotFoundError();
		if (String(pools[0].status) !== 'open') throw new BettingPoolClosedError();
		if (String(pools[0].owner_id) !== actorId && !canOverride) throw new BettingPermissionError();

		const entries = await tx`
			SELECT user_id, amount FROM betting_entries WHERE pool_id=${poolId} FOR UPDATE
		`;
		if (!entries.some((entry: PoolRow) => String(entry.user_id) === winnerId))
			throw new BettingParticipantError();
		const total = entries.reduce(
			(sum: bigint, entry: PoolRow) => sum + moneyToCents(formatMoney(entry.amount)),
			0n
		);
		if (total === 0n) throw new BettingParticipantError();
		const payout = centsToMoney(total);

		await tx`INSERT IGNORE INTO accounts (guild_id, user_id) VALUES (${guildId}, ${winnerId})`;
		await tx`
			SELECT balance FROM accounts WHERE guild_id=${guildId} AND user_id=${winnerId} FOR UPDATE
		`;
		await tx`
			UPDATE accounts SET balance=balance+${payout}
			WHERE guild_id=${guildId} AND user_id=${winnerId}
		`;
		await tx`
			INSERT INTO transactions
				(guild_id, sender_id, recipient_id, amount, transaction_type, betting_pool_id)
			VALUES (${guildId}, ${null}, ${winnerId}, ${payout}, 'bet_payout', ${poolId})
		`;
		await tx`
			UPDATE betting_pools SET status='settled', winner_id=${winnerId}, closed_at=CURRENT_TIMESTAMP
			WHERE id=${poolId}
		`;
		return payout;
	});
}

export async function settleTeamBettingPool(
	guildId: string,
	poolId: string,
	actorId: string,
	winningOption: 'A' | 'B',
	canOverride = false
) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const pools = await tx`
			SELECT owner_id, status, betting_mode FROM betting_pools
			WHERE id=${poolId} AND guild_id=${guildId} FOR UPDATE
		`;
		if (pools.length !== 1) throw new BettingPoolNotFoundError();
		if (String(pools[0].status) !== 'open') throw new BettingPoolClosedError();
		if (String(pools[0].owner_id) !== actorId && !canOverride) throw new BettingPermissionError();
		if (String(pools[0].betting_mode) !== 'team') throw new BettingOptionError();
		const entries = (await tx`
			SELECT user_id, amount, option_key FROM betting_entries
			WHERE pool_id=${poolId} ORDER BY user_id FOR UPDATE
		`) as PoolRow[];
		const total = entries.reduce((sum, entry) => sum + moneyToCents(formatMoney(entry.amount)), 0n);
		const winners = entries.filter((entry) => String(entry.option_key) === winningOption);
		const winningTotal = winners.reduce(
			(sum, entry) => sum + moneyToCents(formatMoney(entry.amount)),
			0n
		);
		if (!total || !winningTotal) throw new BettingParticipantError();
		const payouts = winners.map((entry) => ({
			userId: String(entry.user_id),
			amount: (total * moneyToCents(formatMoney(entry.amount))) / winningTotal
		}));
		let remainder = total - payouts.reduce((sum, payout) => sum + payout.amount, 0n);
		for (const payout of payouts) {
			if (remainder > 0n) {
				payout.amount += 1n;
				remainder -= 1n;
			}
			const amount = centsToMoney(payout.amount);
			await tx`INSERT IGNORE INTO accounts (guild_id, user_id) VALUES (${guildId}, ${payout.userId})`;
			await tx`SELECT balance FROM accounts WHERE guild_id=${guildId} AND user_id=${payout.userId} FOR UPDATE`;
			await tx`UPDATE accounts SET balance=balance+${amount} WHERE guild_id=${guildId} AND user_id=${payout.userId}`;
			await tx`
				INSERT INTO transactions
					(guild_id, sender_id, recipient_id, amount, transaction_type, betting_pool_id)
				VALUES (${guildId}, ${null}, ${payout.userId}, ${amount}, 'bet_payout', ${poolId})
			`;
		}
		await tx`
			UPDATE betting_pools
			SET status='settled', winning_option=${winningOption}, closed_at=CURRENT_TIMESTAMP
			WHERE id=${poolId}
		`;
		await tx`
			INSERT INTO betting_events (pool_id, event_type, user_id, option_key, amount)
			VALUES (${poolId}, 'settled', ${actorId}, ${winningOption}, ${centsToMoney(total)})
		`;
		return { total: centsToMoney(total), winnerCount: payouts.length };
	});
}

export async function getBettingPoolExtras(guildId: string, poolId: string, userId: string) {
	const db = await getDB();
	const [eventRows, statRows] = await Promise.all([
		db`
			SELECT betting_events.id, betting_events.event_type, betting_events.user_id,
				betting_events.option_key, betting_events.amount, betting_events.created_at,
				users.username
			FROM betting_events
			JOIN betting_pools ON betting_pools.id=betting_events.pool_id
			LEFT JOIN users ON users.id=betting_events.user_id
			WHERE betting_events.pool_id=${poolId} AND betting_pools.guild_id=${guildId}
			ORDER BY betting_events.id DESC LIMIT 30
		`,
		db`
			SELECT
				COALESCE(SUM(CASE WHEN transaction_type='bet_stake' THEN amount ELSE 0 END), 0) AS total_staked,
				COALESCE(SUM(CASE WHEN transaction_type='bet_payout' THEN amount ELSE 0 END), 0) AS total_payout,
				COALESCE(SUM(CASE WHEN transaction_type='bet_refund' THEN amount ELSE 0 END), 0) AS total_refund,
				COALESCE(SUM(CASE WHEN transaction_type='bet_weighted' AND recipient_id=${userId} THEN amount ELSE 0 END), 0) AS weighted_received,
				COALESCE(SUM(CASE WHEN transaction_type='bet_weighted' AND sender_id=${userId} THEN amount ELSE 0 END), 0) AS weighted_paid,
				COUNT(DISTINCT CASE WHEN transaction_type='bet_stake' THEN betting_pool_id END) AS pools_joined,
				COUNT(DISTINCT CASE WHEN transaction_type='bet_payout' THEN betting_pool_id END) AS pools_won
			FROM transactions
			WHERE guild_id=${guildId} AND (sender_id=${userId} OR recipient_id=${userId})
		`
	]);
	const eventUserIds = eventRows.map((row: PoolRow) => String(row.user_id || '')).filter(Boolean);
	const names = await getGuildDisplayNames(guildId, eventUserIds);
	const stats = statRows[0] || {};
	const staked = moneyToCents(formatMoney(stats.total_staked || 0));
	const payout = moneyToCents(formatMoney(stats.total_payout || 0));
	const refund = moneyToCents(formatMoney(stats.total_refund || 0));
	const weightedReceived = moneyToCents(formatMoney(stats.weighted_received || 0));
	const weightedPaid = moneyToCents(formatMoney(stats.weighted_paid || 0));
	return {
		events: eventRows.map((row: PoolRow) => ({
			id: String(row.id),
			type: String(row.event_type),
			userId: row.user_id ? String(row.user_id) : null,
			username: row.user_id
				? names.get(String(row.user_id)) || String(row.username || '알 수 없는 사용자')
				: null,
			optionKey: row.option_key === 'A' || row.option_key === 'B' ? row.option_key : null,
			amount: row.amount == null ? null : formatMoney(row.amount),
			createdAt: iso(row.created_at)
		})),
		stats: {
			totalStaked: centsToMoney(staked),
			totalPayout: centsToMoney(payout + weightedReceived),
			totalReturned: centsToMoney(payout + refund + weightedReceived),
			netProfit: centsToMoney(payout + refund + weightedReceived - weightedPaid - staked),
			poolsJoined: Number(stats.pools_joined || 0),
			poolsWon: Number(stats.pools_won || 0)
		}
	};
}

export async function refundBettingPool(
	guildId: string,
	poolId: string,
	actorId: string,
	canOverride = false
) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const pools = await tx`
			SELECT owner_id, status FROM betting_pools
			WHERE id=${poolId} AND guild_id=${guildId} FOR UPDATE
		`;
		if (pools.length !== 1) throw new BettingPoolNotFoundError();
		if (String(pools[0].status) !== 'open') throw new BettingPoolClosedError();
		if (String(pools[0].owner_id) !== actorId && !canOverride) throw new BettingPermissionError();

		const entries = await tx`
			SELECT user_id, amount FROM betting_entries WHERE pool_id=${poolId}
			ORDER BY user_id FOR UPDATE
		`;
		for (const entry of entries as PoolRow[]) {
			const userId = String(entry.user_id);
			const amount = formatMoney(entry.amount);
			await tx`INSERT IGNORE INTO accounts (guild_id, user_id) VALUES (${guildId}, ${userId})`;
			await tx`
				SELECT balance FROM accounts WHERE guild_id=${guildId} AND user_id=${userId} FOR UPDATE
			`;
			await tx`
				UPDATE accounts SET balance=balance+${amount}
				WHERE guild_id=${guildId} AND user_id=${userId}
			`;
			await tx`
				INSERT INTO transactions
					(guild_id, sender_id, recipient_id, amount, transaction_type, betting_pool_id)
				VALUES (${guildId}, ${null}, ${userId}, ${amount}, 'bet_refund', ${poolId})
			`;
		}
		await tx`
			UPDATE betting_pools SET status='refunded', closed_at=CURRENT_TIMESTAMP WHERE id=${poolId}
		`;
		await tx`
			INSERT INTO betting_events (pool_id, event_type, user_id)
			VALUES (${poolId}, 'refunded', ${actorId})
		`;
		return entries.length;
	});
}

export async function fundBettingPool(guildId: string, poolId: string, actorId: string, amount: string) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const pools = await tx`SELECT owner_id,status,house_balance FROM betting_pools WHERE id=${poolId} AND guild_id=${guildId} FOR UPDATE`;
		if (pools.length !== 1) throw new BettingPoolNotFoundError();
		if (String(pools[0].owner_id) !== actorId) throw new BettingPermissionError();
		if (String(pools[0].status) === 'archived') throw new BettingPoolClosedError();
		await tx`INSERT IGNORE INTO accounts (guild_id,user_id) VALUES (${guildId},${actorId})`;
		const accounts = await tx`SELECT balance FROM accounts WHERE guild_id=${guildId} AND user_id=${actorId} FOR UPDATE`;
		if (moneyToCents(formatMoney(accounts[0]?.balance || 0)) < moneyToCents(amount)) throw new InsufficientBalanceError();
		await tx`UPDATE accounts SET balance=balance-${amount} WHERE guild_id=${guildId} AND user_id=${actorId}`;
		await tx`UPDATE betting_pools SET house_balance=house_balance+${amount} WHERE id=${poolId}`;
		await tx`INSERT INTO transactions (guild_id,sender_id,recipient_id,amount,transaction_type,betting_pool_id) VALUES (${guildId},${actorId},${null},${amount},'bet_fund',${poolId})`;
		await tx`INSERT INTO betting_events (pool_id,event_type,user_id,amount) VALUES (${poolId},'funded',${actorId},${amount})`;
		return centsToMoney(moneyToCents(formatMoney(pools[0].house_balance || 0)) + moneyToCents(amount));
	});
}

export async function refundBettingParticipant(guildId: string, poolId: string, actorId: string, userId: string) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const pools = await tx`SELECT owner_id,status,house_balance FROM betting_pools WHERE id=${poolId} AND guild_id=${guildId} FOR UPDATE`;
		if (pools.length !== 1) throw new BettingPoolNotFoundError();
		if (String(pools[0].owner_id) !== actorId) throw new BettingPermissionError();
		if (String(pools[0].status) !== 'open') throw new BettingPoolClosedError();
		const entries = await tx`SELECT amount FROM betting_entries WHERE pool_id=${poolId} AND user_id=${userId} FOR UPDATE`;
		if (entries.length !== 1) throw new BettingParticipantError();
		const amount = formatMoney(entries[0].amount);
		await tx`INSERT IGNORE INTO accounts (guild_id,user_id) VALUES (${guildId},${userId})`;
		await tx`SELECT balance FROM accounts WHERE guild_id=${guildId} AND user_id=${userId} FOR UPDATE`;
		await tx`UPDATE accounts SET balance=balance+${amount} WHERE guild_id=${guildId} AND user_id=${userId}`;
		await tx`DELETE FROM betting_entries WHERE pool_id=${poolId} AND user_id=${userId}`;
		await tx`INSERT INTO transactions (guild_id,sender_id,recipient_id,amount,transaction_type,betting_pool_id) VALUES (${guildId},${null},${userId},${amount},'bet_refund',${poolId})`;
		await tx`INSERT INTO betting_events (pool_id,event_type,user_id,amount) VALUES (${poolId},'user_refund',${userId},${amount})`;
		return amount;
	});
}

export async function payDoubleBettingParticipant(guildId: string, poolId: string, actorId: string, userId: string) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const pools = await tx`SELECT owner_id,status,house_balance FROM betting_pools WHERE id=${poolId} AND guild_id=${guildId} FOR UPDATE`;
		if (pools.length !== 1) throw new BettingPoolNotFoundError();
		const ownerId = String(pools[0].owner_id);
		if (ownerId !== actorId) throw new BettingPermissionError();
		if (String(pools[0].status) !== 'open') throw new BettingPoolClosedError();
		const entries = await tx`SELECT amount FROM betting_entries WHERE pool_id=${poolId} AND user_id=${userId} FOR UPDATE`;
		if (entries.length !== 1) throw new BettingParticipantError();
		const stake = moneyToCents(formatMoney(entries[0].amount));
		const house = moneyToCents(formatMoney(pools[0].house_balance || 0));
		const houseUsed = house < stake ? house : stake;
		const cover = stake - houseUsed;
		const payout = stake * 2n;
		await tx`INSERT IGNORE INTO accounts (guild_id,user_id) VALUES (${guildId},${ownerId}),(${guildId},${userId})`;
		const accounts = await tx`SELECT user_id,balance FROM accounts WHERE guild_id=${guildId} AND user_id IN (${ownerId},${userId}) ORDER BY user_id FOR UPDATE`;
		const owner = accounts.find((row: PoolRow) => String(row.user_id) === ownerId);
		if (cover > 0n && (!owner || moneyToCents(formatMoney(owner.balance)) < cover)) throw new InsufficientBalanceError();
		if (cover > 0n) {
			const amount = centsToMoney(cover);
			await tx`UPDATE accounts SET balance=balance-${amount} WHERE guild_id=${guildId} AND user_id=${ownerId}`;
			await tx`INSERT INTO transactions (guild_id,sender_id,recipient_id,amount,transaction_type,betting_pool_id) VALUES (${guildId},${ownerId},${null},${amount},'bet_house_cover',${poolId})`;
		}
		const payoutText = centsToMoney(payout);
		await tx`UPDATE accounts SET balance=balance+${payoutText} WHERE guild_id=${guildId} AND user_id=${userId}`;
		await tx`UPDATE betting_pools SET house_balance=house_balance-${centsToMoney(houseUsed)} WHERE id=${poolId}`;
		await tx`DELETE FROM betting_entries WHERE pool_id=${poolId} AND user_id=${userId}`;
		await tx`INSERT INTO transactions (guild_id,sender_id,recipient_id,amount,transaction_type,betting_pool_id) VALUES (${guildId},${null},${userId},${payoutText},'bet_payout',${poolId})`;
		await tx`INSERT INTO betting_events (pool_id,event_type,user_id,amount) VALUES (${poolId},'double_payout',${userId},${payoutText})`;
		return { payout: payoutText, ownerCover: centsToMoney(cover), houseBalance: centsToMoney(house-houseUsed) };
	});
}

export async function settleWeightedBettingPool(
	guildId: string,
	poolId: string,
	actorId: string,
	unitAmount: string,
	weights: Array<{ userId: string; weight: number }>
) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const pools = await tx`SELECT owner_id,status FROM betting_pools WHERE id=${poolId} AND guild_id=${guildId} FOR UPDATE`;
		if (pools.length !== 1) throw new BettingPoolNotFoundError();
		if (String(pools[0].owner_id) !== actorId) throw new BettingPermissionError();
		if (String(pools[0].status) !== 'open') throw new BettingPoolClosedError();
		const roster = await tx`
			SELECT user_id FROM betting_pool_members WHERE pool_id=${poolId}
			UNION SELECT user_id FROM betting_entries WHERE pool_id=${poolId}
		`;
		const rosterIds = new Set<string>(roster.map((row: PoolRow) => String(row.user_id)));
		const unique = new Set(weights.map((item) => item.userId));
		if (rosterIds.size < 2 || unique.size !== weights.length || weights.some((item) =>
			!rosterIds.has(item.userId) || !Number.isInteger(item.weight) || Math.abs(item.weight) > 10_000
		)) throw new BettingWeightError();
		const normalized = [...rosterIds].map((userId) => ({
			userId,
			weight: weights.find((item) => item.userId === userId)?.weight || 0
		}));
		const unit = moneyToCents(unitAmount);
		const maxMoney = 999_999_999_999_999n;
		const count = BigInt(normalized.length);
		const weightSum = normalized.reduce((sum, item) => sum + BigInt(item.weight), 0n);
		const centered = normalized.map((item) => ({
			...item,
			centeredNumerator: BigInt(item.weight) * count - weightSum
		}));
		if (!centered.some((item) => item.centeredNumerator > 0n) ||
			!centered.some((item) => item.centeredNumerator < 0n)) throw new BettingWeightError();
		const positiveNumerator = centered.reduce((sum, item) =>
			sum + (item.centeredNumerator > 0n ? item.centeredNumerator : 0n), 0n);
		const totalTransferred = positiveNumerator * unit / count;
		if (totalTransferred <= 0n || totalTransferred > maxMoney) throw new BettingWeightError();
		const deltas = centered.map((item) => ({
			...item,
			amount: (item.centeredNumerator < 0n ? -item.centeredNumerator : item.centeredNumerator) * unit / count,
			remainder: (item.centeredNumerator < 0n ? -item.centeredNumerator : item.centeredNumerator) * unit % count
		}));
		for (const direction of [-1n, 1n]) {
			const side = deltas.filter((item) => item.centeredNumerator * direction > 0n)
				.sort((a, b) => a.remainder === b.remainder ? a.userId.localeCompare(b.userId) : a.remainder > b.remainder ? -1 : 1);
			let remainderCents = totalTransferred - side.reduce((sum, item) => sum + item.amount, 0n);
			for (const item of side) {
				if (remainderCents <= 0n) break;
				item.amount += 1n;
				remainderCents -= 1n;
			}
		}
		if (deltas.some((item) => item.amount > maxMoney)) throw new BettingWeightError();
		const entries = await tx`SELECT user_id,amount FROM betting_entries WHERE pool_id=${poolId} ORDER BY user_id FOR UPDATE`;
		const balances = new Map<string, bigint>();
		for (const userId of [...rosterIds].sort()) {
			await tx`INSERT IGNORE INTO accounts (guild_id,user_id) VALUES (${guildId},${userId})`;
			const account = await tx`SELECT balance FROM accounts WHERE guild_id=${guildId} AND user_id=${userId} FOR UPDATE`;
			balances.set(userId, moneyToCents(formatMoney(account[0]?.balance || 0)));
		}
		for (const entry of entries as PoolRow[]) {
			const userId = String(entry.user_id), amount = formatMoney(entry.amount);
			balances.set(userId, (balances.get(userId) || 0n) + moneyToCents(amount));
			await tx`UPDATE accounts SET balance=balance+${amount} WHERE guild_id=${guildId} AND user_id=${userId}`;
			await tx`INSERT INTO transactions (guild_id,sender_id,recipient_id,amount,transaction_type,betting_pool_id) VALUES (${guildId},${null},${userId},${amount},'bet_refund',${poolId})`;
		}
		for (const item of deltas.filter((entry) => entry.centeredNumerator < 0n))
			if ((balances.get(item.userId) || 0n) < item.amount) throw new InsufficientBalanceError();
		for (const item of deltas) {
			const amount = centsToMoney(item.amount);
			if (item.centeredNumerator < 0n) await tx`UPDATE accounts SET balance=balance-${amount} WHERE guild_id=${guildId} AND user_id=${item.userId}`;
			if (item.centeredNumerator > 0n) await tx`UPDATE accounts SET balance=balance+${amount} WHERE guild_id=${guildId} AND user_id=${item.userId}`;
		}
		const losers = deltas.filter((item) => item.centeredNumerator < 0n).map((item) => ({ ...item, remaining: item.amount }));
		const winners = deltas.filter((item) => item.centeredNumerator > 0n).map((item) => ({ ...item, remaining: item.amount }));
		for (const loser of losers) for (const winner of winners) {
			const amount = loser.remaining < winner.remaining ? loser.remaining : winner.remaining;
			if (amount <= 0n) continue;
			await tx`INSERT INTO transactions (guild_id,sender_id,recipient_id,amount,transaction_type,betting_pool_id) VALUES (${guildId},${loser.userId},${winner.userId},${centsToMoney(amount)},'bet_weighted',${poolId})`;
			loser.remaining -= amount;
			winner.remaining -= amount;
		}
		await tx`DELETE FROM betting_entries WHERE pool_id=${poolId}`;
		const event = await tx`INSERT INTO betting_events (pool_id,event_type,user_id,amount) VALUES (${poolId},'weighted_settled',${actorId},${unitAmount})`;
		const eventId = String(event.lastInsertRowid);
		for (const item of deltas) await tx`INSERT INTO betting_weighted_results (event_id,user_id,weight,amount) VALUES (${eventId},${item.userId},${item.weight},${centsToMoney(item.amount)})`;
		await tx`UPDATE betting_pools SET status='settled',winner_id=NULL,winning_option=NULL,closed_at=CURRENT_TIMESTAMP WHERE id=${poolId}`;
		return { participantCount: normalized.length, totalTransferred: centsToMoney(totalTransferred) };
	});
}

export async function reopenBettingPool(
	guildId: string,
	poolId: string,
	actorId: string,
	canOverride = false
) {
	const db = await getDB();
	await db.begin(async (tx) => {
		const pools = await tx`SELECT owner_id,status,house_balance FROM betting_pools WHERE id=${poolId} AND guild_id=${guildId} FOR UPDATE`;
		if (pools.length !== 1) throw new BettingPoolNotFoundError();
		if (String(pools[0].owner_id) !== actorId && !canOverride) throw new BettingPermissionError();
		if (!['settled', 'refunded'].includes(String(pools[0].status))) throw new BettingPoolClosedError();
		await tx`INSERT IGNORE INTO betting_pool_members (pool_id,user_id) SELECT pool_id,user_id FROM betting_entries WHERE pool_id=${poolId}`;
		await tx`DELETE FROM betting_entries WHERE pool_id=${poolId}`;
		await tx`UPDATE betting_pools SET status='open',winner_id=NULL,winning_option=NULL,closed_at=NULL WHERE id=${poolId}`;
		await tx`INSERT INTO betting_events (pool_id,event_type,user_id) VALUES (${poolId},'reopened',${actorId})`;
	});
}

export async function archiveBettingPool(
	guildId: string,
	poolId: string,
	actorId: string
) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const pools = await tx`SELECT owner_id,status,house_balance FROM betting_pools WHERE id=${poolId} AND guild_id=${guildId} FOR UPDATE`;
		if (pools.length !== 1) throw new BettingPoolNotFoundError();
		if (String(pools[0].owner_id) !== actorId) throw new BettingPermissionError();
		if (String(pools[0].status) === 'archived') throw new BettingPoolClosedError();
		const entries = await tx`SELECT user_id,amount FROM betting_entries WHERE pool_id=${poolId} ORDER BY user_id FOR UPDATE`;
		let refunded = 0;
		if (String(pools[0].status) === 'open') {
			for (const entry of entries as PoolRow[]) {
				const userId = String(entry.user_id), amount = formatMoney(entry.amount);
				await tx`INSERT IGNORE INTO accounts (guild_id,user_id) VALUES (${guildId},${userId})`;
				await tx`SELECT balance FROM accounts WHERE guild_id=${guildId} AND user_id=${userId} FOR UPDATE`;
				await tx`UPDATE accounts SET balance=balance+${amount} WHERE guild_id=${guildId} AND user_id=${userId}`;
				await tx`INSERT INTO transactions (guild_id,sender_id,recipient_id,amount,transaction_type,betting_pool_id) VALUES (${guildId},${null},${userId},${amount},'bet_refund',${poolId})`;
				refunded += 1;
			}
		}
		const houseBalance = moneyToCents(formatMoney(pools[0].house_balance || 0));
		if (houseBalance > 0n) {
			const ownerId = String(pools[0].owner_id), amount = centsToMoney(houseBalance);
			await tx`INSERT IGNORE INTO accounts (guild_id,user_id) VALUES (${guildId},${ownerId})`;
			await tx`SELECT balance FROM accounts WHERE guild_id=${guildId} AND user_id=${ownerId} FOR UPDATE`;
			await tx`UPDATE accounts SET balance=balance+${amount} WHERE guild_id=${guildId} AND user_id=${ownerId}`;
			await tx`INSERT INTO transactions (guild_id,sender_id,recipient_id,amount,transaction_type,betting_pool_id) VALUES (${guildId},${null},${ownerId},${amount},'bet_house_refund',${poolId})`;
		}
		await tx`UPDATE betting_pools SET status='archived',house_balance=0.00,closed_at=CURRENT_TIMESTAMP WHERE id=${poolId}`;
		await tx`INSERT INTO betting_events (pool_id,event_type,user_id) VALUES (${poolId},'archived',${actorId})`;
		return refunded;
	});
}
