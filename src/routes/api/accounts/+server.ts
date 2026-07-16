import { getSessionUserId } from '$lib/server/auth';
import { getDB } from '$lib/server/db';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ cookies }) => {
	const userId = await getSessionUserId(cookies);
	if (!userId) error(401, 'Authentication required.');

	const db = getDB();
	await db`INSERT IGNORE INTO accounts (user_id) VALUES (${userId})`;
	const rows = await db`
		SELECT id, user_id, balance, created_at
		FROM accounts
		WHERE user_id = ${userId}
		LIMIT 1
	`;

	return json({ account: rows[0] });
};
