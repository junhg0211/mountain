import { getSessionUser } from '$lib/server/auth';
import { requireGuildManager } from '$lib/server/basecamp';
import { getDB } from '$lib/server/db';
import { getWorldSettings, listWorldProps, listWorldRooms, listWorldTiles, listWorldWalls } from '$lib/server/db/world';
import { getGuildCategories, getGuildMember, getGuildRoles } from '$lib/server/discord/users';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

async function userGuilds(userId: string) {
	const db = await getDB();
	const rows = await db`
		SELECT guild_id, guild_name FROM user_guilds
		WHERE user_id=${userId} ORDER BY guild_name
	`;
	return rows.map((row: Record<string, unknown>) => ({
		id: String(row.guild_id),
		name: String(row.guild_name)
	}));
}

const emptyWorld = {
	guildId: null,
	rooms: [],
	walls: [],
	tiles: [],
	props: [],
	settings: null,
	canManage: false,
	categories: [],
	roles: []
} as const;

export const load: PageServerLoad = async ({ cookies, url }) => {
	const user = await getSessionUser(cookies);
	if (!user) redirect(303, '/login');
	const guilds = await userGuilds(user.id);
	const requested = url.searchParams.get('guild');
	const guildId = guilds.some((guild: { id: string }) => guild.id === requested)
		? requested!
		: guilds[0]?.id;
	if (!guildId || !(await getGuildMember(guildId, user.id))) return { user, guilds, ...emptyWorld };

	let canManage = false;
	try {
		await requireGuildManager(guildId, user.id);
		canManage = true;
	} catch (error) {
		console.error('Basecamp permission check failed:', error);
	}
	const [rooms, walls, tiles, props, settings] = await Promise.all([
		listWorldRooms(guildId),
		listWorldWalls(guildId),
		listWorldTiles(guildId),
		listWorldProps(guildId),
		getWorldSettings(guildId)
	]);
	const [categories, roles] = canManage
		? await Promise.all([getGuildCategories(guildId), getGuildRoles(guildId)])
		: [[], []];
	return {
		user,
		guilds,
		guildId,
		rooms,
		walls,
		tiles,
		props,
		settings,
		canManage,
		categories,
		roles: roles.filter((role) => !role.managed && role.name !== '@everyone')
	};
};
