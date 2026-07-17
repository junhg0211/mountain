import { getSessionUser } from '$lib/server/auth';
import { getDB } from '$lib/server/db';
import { getBettingPool, getBettingPools } from '$lib/server/db/betting';
import { getBettingPoolExtras } from '$lib/server/db/betting';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getOrCreateBalance } from '$lib/server/db/accounts';

export const GET: RequestHandler = async ({ cookies, params, url }) => {
	const user = await getSessionUser(cookies);
	if (!user) error(401, 'Authentication required.');
	if (!params.guildId) error(400, 'Guild ID is required.');
	const db = await getDB();
	const membership = await db`
		SELECT 1 FROM user_guilds WHERE user_id=${user.id} AND guild_id=${params.guildId} LIMIT 1
	`;
	if (membership.length !== 1) error(403, 'Guild access denied.');
	const poolId = url.searchParams.get('pool');
	if (poolId) {
		const pool = await getBettingPool(params.guildId, poolId);
		if (!pool) error(404, 'Betting pool not found.');
		return json({
			pool,
			...(await getBettingPoolExtras(params.guildId, poolId, user.id)),
			balance: await getOrCreateBalance(params.guildId, user.id)
		});
	}
	return json({ pools: await getBettingPools(params.guildId) });
};
