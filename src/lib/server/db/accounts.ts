import { getDB } from '$lib/server/db';
import { centsToMoney, moneyToCents } from '$lib/server/economy/money';

export class InsufficientBalanceError extends Error {}

export async function getOrCreateBalance(guildId: string, userId: string): Promise<string> {
	const db = getDB();
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

export async function transferBalance(
	guildId: string,
	senderId: string,
	recipientId: string,
	amount: string
): Promise<string> {
	const db = getDB();

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
