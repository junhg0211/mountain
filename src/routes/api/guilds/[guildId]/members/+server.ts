import { getSessionUser } from '$lib/server/auth';
import { getDB } from '$lib/server/db';
import { searchGuildMembers } from '$lib/server/discord/users';
import { error, json, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ cookies, params, url }) => {
	const user = await getSessionUser(cookies);
	if (!user) error(401, 'Authentication required.');
	if (!params.guildId) error(400, 'Guild ID is required.');
	const query = (url.searchParams.get('q') || '').trim();
	if (query.length < 1 || query.length > 32) return json({ members: [] });

	const db = await getDB();
	const membership = await db`
		SELECT 1 FROM user_guilds WHERE user_id = ${user.id} AND guild_id = ${params.guildId} LIMIT 1
	`;
	if (membership.length !== 1) error(403, 'Guild access denied.');

	const members = await searchGuildMembers(params.guildId, query);
	return json({
		members: members
			.filter((member) => !member.user.bot && member.user.id !== user.id)
			.map((member) => ({
				id: member.user.id,
				username: member.nick || member.user.global_name || member.user.username,
				avatarUrl: member.user.avatar
					? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`
					: null
			}))
	});
};
