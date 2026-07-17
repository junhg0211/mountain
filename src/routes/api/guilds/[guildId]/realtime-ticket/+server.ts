import { getSessionUser } from '$lib/server/auth';
import { getDB } from '$lib/server/db';
import { createRealtimeTicket } from '$lib/server/realtime';
import { error, json, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ cookies, params }) => {
	const user = await getSessionUser(cookies);
	if (!user) error(401, 'Authentication required.');
	if (!params.guildId) error(400, 'Guild ID is required.');
	const db = await getDB();
	const membership = await db`
		SELECT 1 FROM user_guilds WHERE user_id=${user.id} AND guild_id=${params.guildId} LIMIT 1
	`;
	if (membership.length !== 1) error(403, 'Guild access denied.');
	return json({ ticket: createRealtimeTicket(params.guildId, user.id) });
};
