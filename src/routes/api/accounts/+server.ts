import { getSessionUserId } from '$lib/server/auth';
import { getDB } from '$lib/server/db';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ cookies }) => {
	const userId = await getSessionUserId(cookies);
	if (!userId) error(401, 'Authentication required.');

	const db = await getDB();
	const rows = await db`
		SELECT
			accounts.id,
			accounts.guild_id,
			accounts.user_id,
			accounts.balance,
			accounts.created_at,
			COALESCE(guild_settings.currency_unit, 'coin') AS currency_unit
		FROM accounts
		LEFT JOIN guild_settings ON guild_settings.guild_id = accounts.guild_id
		WHERE accounts.user_id = ${userId}
		ORDER BY accounts.created_at ASC
	`;

	return json({ accounts: rows });
};
