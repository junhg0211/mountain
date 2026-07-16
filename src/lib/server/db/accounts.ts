import { getDB } from '$lib/server/db';

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
	return Number(rows[0].balance).toFixed(2);
}
