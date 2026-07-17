import { getDB } from '$lib/server/db';
import { centsToMoney, moneyToCents } from '$lib/server/economy/money';

export class InsufficientBalanceError extends Error {}
export type BalanceAdjustmentType = 'mint' | 'burn';
export type TransactionType =
	| 'transfer'
	| 'mint'
	| 'burn'
	| 'bet_stake'
	| 'bet_payout'
	| 'bet_refund'
	| 'attendance'
	| 'voice_activity'
	| 'monthly_burn';

export async function getOrCreateBalance(guildId: string, userId: string): Promise<string> {
	const db = await getDB();
	await db`INSERT IGNORE INTO accounts (guild_id, user_id) VALUES (${guildId}, ${userId})`;

	const rows = await db`
		SELECT balance
		FROM accounts
		WHERE guild_id = ${guildId} AND user_id = ${userId}
		LIMIT 1
	`;

	if (rows.length !== 1) throw new Error(`Account for user ${userId} could not be loaded.`);
	return formatBalance(rows[0].balance);
}

export async function getBalanceRanking(guildId: string, limit = 10) {
	const db = await getDB();
	const rows = await db`
		SELECT users.id, users.username, accounts.balance
		FROM accounts
		JOIN users ON users.id = accounts.user_id
		WHERE accounts.guild_id = ${guildId}
		ORDER BY accounts.balance DESC, accounts.created_at ASC
		LIMIT ${limit}
	`;
	return rows.map((row: { id: unknown; username: unknown; balance: unknown }, index: number) => ({
		rank: index + 1,
		userId: String(row.id),
		username: String(row.username),
		balance: formatBalance(row.balance)
	}));
}

export async function getTotalSupply(guildId: string): Promise<string> {
	const db = await getDB();
	const rows = await db`
		SELECT
			(SELECT COALESCE(SUM(balance), 0.00) FROM accounts WHERE guild_id=${guildId}) +
			(SELECT COALESCE(SUM(betting_entries.amount), 0.00)
			 FROM betting_entries
			 JOIN betting_pools ON betting_pools.id=betting_entries.pool_id
			 WHERE betting_pools.guild_id=${guildId} AND betting_pools.status='open') AS total
	`;
	return formatBalance(rows[0]?.total || 0);
}

export async function getUserTransactions(guildId: string, userId: string, limit = 20) {
	const db = await getDB();
	const rows = await db`
		SELECT transactions.id, transactions.sender_id, transactions.recipient_id,
			transactions.amount, transactions.transaction_type, transactions.created_at,
			transactions.betting_pool_id, betting_pools.title AS betting_pool_title,
			sender.username AS sender_name, recipient.username AS recipient_name
		FROM transactions
		LEFT JOIN users sender ON sender.id = transactions.sender_id
		LEFT JOIN users recipient ON recipient.id = transactions.recipient_id
		LEFT JOIN betting_pools ON betting_pools.id = transactions.betting_pool_id
		WHERE transactions.guild_id = ${guildId}
			AND (transactions.sender_id = ${userId} OR transactions.recipient_id = ${userId})
		ORDER BY transactions.created_at DESC, transactions.id DESC
		LIMIT ${limit}
	`;

	return rows.map((row: Record<string, unknown>) => {
		const type = String(row.transaction_type) as TransactionType;
		const outgoing = String(row.sender_id || '') === userId;
		const credit =
			type === 'mint' ||
			type === 'bet_payout' ||
			type === 'bet_refund' ||
			type === 'attendance' ||
			type === 'voice_activity' ||
			(!outgoing && type === 'transfer');
		return {
			id: String(row.id),
			type,
			direction: credit ? 'credit' : 'debit',
			counterparty:
				type === 'transfer'
					? String(
							outgoing
								? row.recipient_name || '알 수 없는 사용자'
								: row.sender_name || '알 수 없는 사용자'
						)
					: null,
			amount: formatBalance(row.amount),
			bettingPool: row.betting_pool_id
				? { id: String(row.betting_pool_id), title: String(row.betting_pool_title || '베팅 판') }
				: null,
			createdAt: new Date(row.created_at as string | number | Date).toISOString()
		};
	});
}

export async function getGuildTransactions(guildId: string, limit = 50) {
	const db = await getDB();
	const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
	const rows = await db`
		SELECT transactions.id, transactions.sender_id, transactions.recipient_id,
			transactions.amount, transactions.transaction_type, transactions.created_at,
			transactions.betting_pool_id, betting_pools.title AS betting_pool_title,
			sender.username AS sender_name, recipient.username AS recipient_name
		FROM transactions
		LEFT JOIN users sender ON sender.id = transactions.sender_id
		LEFT JOIN users recipient ON recipient.id = transactions.recipient_id
		LEFT JOIN betting_pools ON betting_pools.id = transactions.betting_pool_id
		WHERE transactions.guild_id=${guildId}
		ORDER BY transactions.created_at DESC, transactions.id DESC
		LIMIT ${safeLimit}
	`;
	return rows.map((row: Record<string, unknown>) => ({
		id: String(row.id),
		type: String(row.transaction_type) as TransactionType,
		amount: formatBalance(row.amount),
		sender: row.sender_id
			? { id: String(row.sender_id), name: String(row.sender_name || '알 수 없는 사용자') }
			: null,
		recipient: row.recipient_id
			? { id: String(row.recipient_id), name: String(row.recipient_name || '알 수 없는 사용자') }
			: null,
		bettingPool: row.betting_pool_id
			? { id: String(row.betting_pool_id), title: String(row.betting_pool_title || '베팅 판') }
			: null,
		createdAt: new Date(row.created_at as string | number | Date).toISOString()
	}));
}

export async function adjustBalance(
	guildId: string,
	userId: string,
	amount: string,
	type: BalanceAdjustmentType
): Promise<string> {
	const db = await getDB();
	return db.begin(async (tx) => {
		await tx`INSERT IGNORE INTO accounts (guild_id, user_id) VALUES (${guildId}, ${userId})`;
		const rows =
			await tx`SELECT balance FROM accounts WHERE guild_id=${guildId} AND user_id=${userId} FOR UPDATE`;
		if (rows.length !== 1) throw new Error('Account could not be loaded.');
		const current = moneyToCents(formatBalance(rows[0].balance));
		const adjustment = moneyToCents(amount);
		if (type === 'burn' && current < adjustment) throw new InsufficientBalanceError();
		const next = type === 'mint' ? current + adjustment : current - adjustment;
		await tx`UPDATE accounts SET balance=${centsToMoney(next)} WHERE guild_id=${guildId} AND user_id=${userId}`;
		if (type === 'mint') {
			await tx`INSERT INTO transactions (guild_id, sender_id, recipient_id, amount, transaction_type) VALUES (${guildId}, ${null}, ${userId}, ${amount}, 'mint')`;
		} else {
			await tx`INSERT INTO transactions (guild_id, sender_id, recipient_id, amount, transaction_type) VALUES (${guildId}, ${userId}, ${null}, ${amount}, 'burn')`;
		}
		return centsToMoney(next);
	});
}

export async function transferBalance(
	guildId: string,
	senderId: string,
	recipientId: string,
	amount: string
): Promise<string> {
	const db = await getDB();

	return db.begin(async (tx) => {
		await tx`INSERT IGNORE INTO accounts (guild_id, user_id) VALUES (${guildId}, ${senderId})`;
		await tx`INSERT IGNORE INTO accounts (guild_id, user_id) VALUES (${guildId}, ${recipientId})`;

		const rows = await tx`
			SELECT user_id, balance
			FROM accounts
			WHERE guild_id = ${guildId} AND (user_id = ${senderId} OR user_id = ${recipientId})
			ORDER BY user_id
			FOR UPDATE
		`;
		const sender = rows.find(
			(row: { user_id: unknown; balance: unknown }) => String(row.user_id) === senderId
		);
		const senderBalance = sender ? moneyToCents(formatBalance(sender.balance)) : 0n;
		const transferAmount = moneyToCents(amount);
		if (!sender || senderBalance < transferAmount) {
			throw new InsufficientBalanceError();
		}

		await tx`
			UPDATE accounts
			SET balance = balance - ${amount}
			WHERE guild_id = ${guildId} AND user_id = ${senderId}
		`;
		await tx`
			UPDATE accounts
			SET balance = balance + ${amount}
			WHERE guild_id = ${guildId} AND user_id = ${recipientId}
		`;
		await tx`
			INSERT INTO transactions (guild_id, sender_id, recipient_id, amount, transaction_type)
			VALUES (${guildId}, ${senderId}, ${recipientId}, ${amount}, 'transfer')
		`;

		return centsToMoney(senderBalance - transferAmount);
	});
}

function formatBalance(value: unknown): string {
	const [integer, fraction = ''] = String(value).split('.');
	return `${integer}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}
