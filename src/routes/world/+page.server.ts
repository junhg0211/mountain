import { getSessionUser } from '$lib/server/auth';
import { getClient } from '$lib/server/bot';
import {
	activateWorldRoom,
	createWorldRoomDraft,
	failWorldRoom,
	getWorldSettings,
	listWorldRooms,
	setWorldSettings
} from '$lib/server/db/world';
import {
	createGuildVoiceChannel,
	deleteGuildChannel,
	getGuildCategories,
	getGuildMember,
	getGuildRoles,
	updateGuildVoiceChannel
} from '$lib/server/discord/users';
import { PermissionsBitField } from 'discord.js';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

async function requireGuildManager(guildId: string, userId: string) {
	if (!/^\d{17,20}$/.test(guildId)) return false;
	if (!(await getGuildMember(guildId, userId))) return false;
	const client = getClient();
	if (!client?.isReady()) throw new Error('Discord 봇이 아직 준비되지 않았습니다.');
	const guild = await client.guilds.fetch(guildId);
	const member = await guild.members.fetch(userId);
	return member.permissions.has(PermissionsBitField.Flags.ManageGuild);
}

async function requireBasecampBotPermissions(guildId: string, roleId: string) {
	const client = getClient();
	if (!client?.isReady()) throw new Error('Discord 봇이 아직 준비되지 않았습니다.');
	const guild = await client.guilds.fetch(guildId);
	const [botMember, role] = await Promise.all([guild.members.fetchMe(), guild.roles.fetch(roleId)]);
	if (
		!botMember.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
		!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)
	)
		throw new Error('BASECAMP_BOT_PERMISSIONS');
	if (!role || botMember.roles.highest.comparePositionTo(role) <= 0)
		throw new Error('BASECAMP_ROLE_HIERARCHY');
}

async function userGuilds(userId: string) {
	const { getDB } = await import('$lib/server/db');
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

export const load: PageServerLoad = async ({ cookies, url }) => {
	const user = await getSessionUser(cookies);
	if (!user) redirect(303, '/login');
	const guilds = await userGuilds(user.id);
	const requested = url.searchParams.get('guild');
	const guildId = guilds.some((guild: { id: string }) => guild.id === requested)
		? requested!
		: guilds[0]?.id;
	if (!guildId)
		return {
			user,
			guilds,
			guildId: null,
			rooms: [],
			settings: null,
			canManage: false,
			categories: [],
			roles: []
		};
	const member = await getGuildMember(guildId, user.id);
	if (!member)
		return {
			user,
			guilds,
			guildId: null,
			rooms: [],
			settings: null,
			canManage: false,
			categories: [],
			roles: []
		};
	let canManage = false;
	try {
		canManage = await requireGuildManager(guildId, user.id);
	} catch (error) {
		console.error('World permission check failed:', error);
	}
	const [rooms, settings] = await Promise.all([listWorldRooms(guildId), getWorldSettings(guildId)]);
	const [categories, roles] = canManage
		? await Promise.all([getGuildCategories(guildId), getGuildRoles(guildId)])
		: [[], []];
	return {
		user,
		guilds,
		guildId,
		rooms,
		settings,
		canManage,
		categories,
		roles: roles.filter((role) => !role.managed && role.name !== '@everyone')
	};
};

export const actions: Actions = {
	configure: async ({ cookies, request }) => {
		const user = await getSessionUser(cookies);
		if (!user) return fail(401, { message: '로그인이 필요합니다.' });
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const categoryId = String(form.get('categoryId') || '');
		const accessRoleId = String(form.get('accessRoleId') || '');
		if (!(await requireGuildManager(guildId, user.id)))
			return fail(403, { message: '현재 Discord 서버 관리 권한이 필요합니다.' });
		const [categories, roles] = await Promise.all([
			getGuildCategories(guildId),
			getGuildRoles(guildId)
		]);
		if (!categories.some((category) => category.id === categoryId))
			return fail(400, { message: '유효한 음성 채널 카테고리를 선택해 주세요.' });
		if (!roles.some((role) => role.id === accessRoleId && !role.managed && role.name !== '@everyone'))
			return fail(400, { message: '유효한 월드 접속자 역할을 선택해 주세요.' });
		try {
			await requireBasecampBotPermissions(guildId, accessRoleId);
		} catch (error) {
			if (error instanceof Error && error.message === 'BASECAMP_BOT_PERMISSIONS')
				return fail(400, { message: 'Mountain 봇에 채널 관리와 역할 관리 권한을 부여해 주세요.' });
			if (error instanceof Error && error.message === 'BASECAMP_ROLE_HIERARCHY')
				return fail(400, { message: 'Mountain 봇 역할을 월드 접속자 역할보다 위로 옮겨 주세요.' });
			throw error;
		}
		const current = await getWorldSettings(guildId);
		let lobbyChannelId = current.lobbyChannelId;
		let createdLobbyId: string | null = null;
		if (lobbyChannelId) {
			const updated = await updateGuildVoiceChannel({
				guildId,
				channelId: lobbyChannelId,
				categoryId,
				accessRoleId,
				name: '월드 광장'
			});
			if (!updated) lobbyChannelId = null;
		}
		if (!lobbyChannelId) {
			const lobby = await createGuildVoiceChannel({
				guildId,
				categoryId,
				accessRoleId,
				name: '월드 광장'
			});
			lobbyChannelId = lobby.id;
			createdLobbyId = lobby.id;
		}
		try {
			await setWorldSettings(guildId, { categoryId, accessRoleId, lobbyChannelId });
		} catch (error) {
			if (createdLobbyId) await deleteGuildChannel(createdLobbyId);
			throw error;
		}
		return { success: true, message: '월드 광장 채널과 Discord 연결 설정을 저장했습니다.' };
	},
	createRoom: async ({ cookies, request }) => {
		const user = await getSessionUser(cookies);
		if (!user) return fail(401, { message: '로그인이 필요합니다.' });
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const name = String(form.get('name') || '').trim();
		const x = Number(form.get('x'));
		const y = Number(form.get('y'));
		const width = Number(form.get('width'));
		const height = Number(form.get('height'));
		if (!(await requireGuildManager(guildId, user.id)))
			return fail(403, { message: '현재 Discord 서버 관리 권한이 필요합니다.' });
		if (!name || name.length > 80)
			return fail(400, { message: '방 이름은 1~80자로 입력해 주세요.' });
		if (
			![x, y, width, height].every(Number.isInteger) ||
			x < 0 ||
			y < 0 ||
			width < 2 ||
			height < 2 ||
			x + width > 40 ||
			y + height > 24
		)
			return fail(400, { message: '월드 안에 2×2 이상의 방을 그려 주세요.' });
		const settings = await getWorldSettings(guildId);
		if (!settings.categoryId || !settings.accessRoleId || !settings.lobbyChannelId)
			return fail(400, { message: '먼저 Discord 카테고리와 월드 접속자 역할을 설정해 주세요.' });
		const [categories, roles] = await Promise.all([
			getGuildCategories(guildId),
			getGuildRoles(guildId)
		]);
		if (!categories.some((category) => category.id === settings.categoryId))
			return fail(400, { message: '설정한 Discord 카테고리를 찾을 수 없습니다.' });
		if (!roles.some((role) => role.id === settings.accessRoleId && !role.managed))
			return fail(400, { message: '설정한 월드 접속자 역할을 찾을 수 없습니다.' });

		const id = crypto.randomUUID();
		try {
			await createWorldRoomDraft({ id, guildId, name, x, y, width, height, createdBy: user.id });
		} catch (error) {
			if (error instanceof Error && error.message === 'ROOM_OVERLAP')
				return fail(409, { message: '다른 방과 겹치지 않게 그려 주세요.' });
			if (error instanceof Error && error.message === 'ROOM_LIMIT')
				return fail(400, { message: '한 월드에는 방을 최대 50개까지 만들 수 있습니다.' });
			throw error;
		}

		let channelId: string | null = null;
		try {
			const channel = await createGuildVoiceChannel({
				guildId,
				categoryId: settings.categoryId,
				accessRoleId: settings.accessRoleId,
				name
			});
			channelId = channel.id;
			await activateWorldRoom(guildId, id, channel.id);
			return { success: true, message: `${name} 방과 Discord 음성 채널을 만들었습니다.` };
		} catch (error) {
			await failWorldRoom(guildId, id);
			if (channelId) {
				try {
					await deleteGuildChannel(channelId);
				} catch (cleanupError) {
					console.error('Orphaned world voice channel cleanup failed:', cleanupError);
				}
			}
			console.error('World room creation failed:', error);
			return fail(502, { message: 'Discord 음성 채널을 만들지 못했습니다. 봇 권한을 확인해 주세요.' });
		}
	}
};
