import { getDB } from '$lib/server/db';

export async function getOrCreateBalance(userId: string): Promise<string> {
	const db = getDB();
	await db`INSERT IGNORE INTO accounts (user_id) VALUES (${userId})`;

	const rows = await db`
		SELECT balance
		FROM accounts
		WHERE user_id = ${userId}
		LIMIT 1
	`;

	if (rows.length !== 1) throw new Error(`Account for user ${userId} could not be loaded.`);
	return Number(rows[0].balance).toFixed(2);
}
