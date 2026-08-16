import { getSessionUser } from '$lib/server/auth';
import { getDB } from '$lib/server/db';
import { getInventory } from '$lib/server/db/items';
import { canManageGuild } from '$lib/server/db/user-guilds';
import { getWorldSettings, listWorldDoors, listWorldProps, listWorldRooms, listWorldTiles, listWorldTileTypes, listWorldWalls } from '$lib/server/db/world';
import { getGuildCategories, getGuildMember, getGuildRoles } from '$lib/server/discord/users';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

async function userGuilds(userId: string) {
	const db = await getDB();
	const rows = await db`
		SELECT guild_id, guild_name, permissions FROM user_guilds
		WHERE user_id=${userId} ORDER BY guild_name
	`;
	return rows.map((row: Record<string, unknown>) => ({
		id: String(row.guild_id),
		name: String(row.guild_name),
		permissions: String(row.permissions)
	}));
}

const emptyWorld = {
	guildId: null,
	rooms: [],
	walls: [],
	doors: [],
	tiles: [],
	tileTypes: [],
	props: [],
	settings: null,
	canManage: false,
	categories: [],
	roles: [],
	inventory: []
} as const;

export const load: PageServerLoad = async ({ cookies, url }) => {
	const user = await getSessionUser(cookies);
	if (!user) redirect(303, '/login');
	const guilds = await userGuilds(user.id);
	const requested = url.searchParams.get('guild');
	const selectedGuild = guilds.find((guild: { id: string }) => guild.id === requested) || guilds[0];
	const guildId = selectedGuild?.id;
	if (!guildId || !(await getGuildMember(guildId, user.id))) return { user, guilds, ...emptyWorld };

	const canManage = canManageGuild(selectedGuild.permissions);
	const [rooms, walls, doors, tiles, tileTypes, props, settings, inventory] = await Promise.all([
		listWorldRooms(guildId),
		listWorldWalls(guildId),
		listWorldDoors(guildId),
		listWorldTiles(guildId),
		listWorldTileTypes(guildId),
		listWorldProps(guildId),
		getWorldSettings(guildId),
		getInventory(guildId, user.id)
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
		doors,
		tiles,
		tileTypes,
		props,
		settings,
		inventory,
		canManage,
		categories,
		roles: roles.filter((role) => !role.managed && role.name !== '@everyone')
	};
};
