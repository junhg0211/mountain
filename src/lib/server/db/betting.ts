import { getDB } from '$lib/server/db';
import { centsToMoney, moneyToCents } from '$lib/server/economy/money';
import { InsufficientBalanceError } from './accounts';

export type BettingPoolStatus = 'open' | 'settled' | 'refunded';

export class BettingPoolNotFoundError extends Error {}
export class BettingPoolClosedError extends Error {}
export class BettingPermissionError extends Error {}
export class BettingParticipantError extends Error {}

type PoolRow = Record<string, unknown>;

function formatMoney(value: unknown): string {
	const [integer, fraction = ''] = String(value).split('.');
	return `${integer}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

function iso(value: unknown): string {
	return new Date(value as string | number | Date).toISOString();
}

async function mapPools(rows: PoolRow[]) {
	const db = await getDB();
	return Promise.all(
		rows.map(async (row) => {
			const entries = await db`
				SELECT betting_entries.user_id, betting_entries.amount, users.username
				FROM betting_entries
				LEFT JOIN users ON users.id = betting_entries.user_id
				WHERE betting_entries.pool_id = ${String(row.id)}
				ORDER BY betting_entries.amount DESC, betting_entries.updated_at ASC
			`;
			return {
				id: String(row.id),
				guildId: String(row.guild_id),
				ownerId: String(row.owner_id),
				ownerName: String(row.owner_name || '알 수 없는 사용자'),
				title: String(row.title),
				status: String(row.status) as BettingPoolStatus,
				winnerId: row.winner_id ? String(row.winner_id) : null,
				winnerName: row.winner_name ? String(row.winner_name) : null,
				totalAmount: formatMoney(row.total_amount || 0),
				participantCount: Number(row.participant_count || 0),
				createdAt: iso(row.created_at),
				closedAt: row.closed_at ? iso(row.closed_at) : null,
				participants: entries.map((entry: PoolRow) => ({
					userId: String(entry.user_id),
					username: String(entry.username || '알 수 없는 사용자'),
					amount: formatMoney(entry.amount)
				}))
			};
		})
	);
}

const poolSelect = `
	SELECT betting_pools.*,
		owner.username AS owner_name, winner.username AS winner_name,
		COALESCE(SUM(betting_entries.amount), 0.00) AS total_amount,
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
		 WHERE betting_pools.guild_id = ?
		 GROUP BY betting_pools.id
		 ORDER BY (betting_pools.status = 'open') DESC, betting_pools.created_at DESC
		 LIMIT ?`,
		[guildId, limit]
	);
	return mapPools(rows as PoolRow[]);
}

export async function getBettingPool(guildId: string, poolId: string) {
	const db = await getDB();
	const rows = await db.unsafe(
		`${poolSelect}
		 WHERE betting_pools.guild_id = ? AND betting_pools.id = ?
		 GROUP BY betting_pools.id LIMIT 1`,
		[guildId, poolId]
	);
	const pools = await mapPools(rows as PoolRow[]);
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
		return entries.length;
	});
}
