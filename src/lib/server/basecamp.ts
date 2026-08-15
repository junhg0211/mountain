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

export class BasecampError extends Error {}

export async function requireGuildManager(guildId: string, userId: string) {
	if (!/^\d{17,20}$/.test(guildId) || !(await getGuildMember(guildId, userId)))
		throw new BasecampError('현재 Discord 서버 관리 권한이 필요합니다.');
	const client = getClient();
	if (!client?.isReady()) throw new BasecampError('Discord 봇이 아직 준비되지 않았습니다.');
	const guild = await client.guilds.fetch(guildId);
	const member = await guild.members.fetch(userId);
	if (!member.permissions.has(PermissionsBitField.Flags.ManageGuild))
		throw new BasecampError('현재 Discord 서버 관리 권한이 필요합니다.');
}

async function requireBasecampBotPermissions(guildId: string, roleId: string) {
	const client = getClient();
	if (!client?.isReady()) throw new BasecampError('Discord 봇이 아직 준비되지 않았습니다.');
	const guild = await client.guilds.fetch(guildId);
	const [botMember, role] = await Promise.all([guild.members.fetchMe(), guild.roles.fetch(roleId)]);
	if (
		!botMember.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
		!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles) ||
		!botMember.permissions.has(PermissionsBitField.Flags.MoveMembers)
	)
		throw new BasecampError('Mountain 봇에 채널 관리, 역할 관리, 멤버 이동 권한을 부여해 주세요.');
	if (!role || botMember.roles.highest.comparePositionTo(role) <= 0)
		throw new BasecampError('Mountain 봇 역할을 월드 접속자 역할보다 위로 옮겨 주세요.');
}

export async function getBasecampState(guildId: string) {
	const [rooms, settings] = await Promise.all([listWorldRooms(guildId), getWorldSettings(guildId)]);
	return { rooms, settings };
}

export async function configureBasecamp(input: {
	guildId: string;
	userId: string;
	categoryId: string;
	accessRoleId: string;
}) {
	await requireGuildManager(input.guildId, input.userId);
	const [categories, roles] = await Promise.all([
		getGuildCategories(input.guildId),
		getGuildRoles(input.guildId)
	]);
	if (!categories.some((category) => category.id === input.categoryId))
		throw new BasecampError('유효한 음성 채널 카테고리를 선택해 주세요.');
	if (
		!roles.some(
			(role) => role.id === input.accessRoleId && !role.managed && role.name !== '@everyone'
		)
	)
		throw new BasecampError('유효한 월드 접속자 역할을 선택해 주세요.');
	await requireBasecampBotPermissions(input.guildId, input.accessRoleId);

	const current = await getWorldSettings(input.guildId);
	let lobbyChannelId = current.lobbyChannelId;
	let createdLobbyId: string | null = null;
	if (lobbyChannelId) {
		const updated = await updateGuildVoiceChannel({
			guildId: input.guildId,
			channelId: lobbyChannelId,
			categoryId: input.categoryId,
			accessRoleId: input.accessRoleId,
			name: '월드 광장'
		});
		if (!updated) lobbyChannelId = null;
	}
	if (!lobbyChannelId) {
		const lobby = await createGuildVoiceChannel({
			guildId: input.guildId,
			categoryId: input.categoryId,
			accessRoleId: input.accessRoleId,
			name: '월드 광장'
		});
		lobbyChannelId = lobby.id;
		createdLobbyId = lobby.id;
	}
	try {
		await setWorldSettings(input.guildId, {
			categoryId: input.categoryId,
			accessRoleId: input.accessRoleId,
			lobbyChannelId
		});
	} catch (error) {
		if (createdLobbyId) await deleteGuildChannel(createdLobbyId);
		throw error;
	}
	return getBasecampState(input.guildId);
}

export async function createBasecampRoom(input: {
	guildId: string;
	userId: string;
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
}) {
	await requireGuildManager(input.guildId, input.userId);
	const name = input.name.trim();
	if (!name || name.length > 80) throw new BasecampError('방 이름은 1~80자로 입력해 주세요.');
	if (
		![input.x, input.y, input.width, input.height].every(Number.isInteger) ||
		input.x < 0 ||
		input.y < 0 ||
		input.width < 2 ||
		input.height < 2 ||
		input.x + input.width > 40 ||
		input.y + input.height > 24
	)
		throw new BasecampError('월드 안에 2×2 이상의 방을 그려 주세요.');
	const settings = await getWorldSettings(input.guildId);
	if (!settings.categoryId || !settings.accessRoleId || !settings.lobbyChannelId)
		throw new BasecampError('먼저 Discord 카테고리와 월드 접속자 역할을 설정해 주세요.');
	const [categories, roles] = await Promise.all([
		getGuildCategories(input.guildId),
		getGuildRoles(input.guildId)
	]);
	if (!categories.some((category) => category.id === settings.categoryId))
		throw new BasecampError('설정한 Discord 카테고리를 찾을 수 없습니다.');
	if (!roles.some((role) => role.id === settings.accessRoleId && !role.managed))
		throw new BasecampError('설정한 월드 접속자 역할을 찾을 수 없습니다.');

	const id = crypto.randomUUID();
	try {
		await createWorldRoomDraft({ ...input, id, name, createdBy: input.userId });
	} catch (error) {
		if (error instanceof Error && error.message === 'ROOM_OVERLAP')
			throw new BasecampError('다른 방과 겹치지 않게 그려 주세요.');
		if (error instanceof Error && error.message === 'ROOM_LIMIT')
			throw new BasecampError('한 월드에는 방을 최대 50개까지 만들 수 있습니다.');
		throw error;
	}

	let channelId: string | null = null;
	try {
		const channel = await createGuildVoiceChannel({
			guildId: input.guildId,
			categoryId: settings.categoryId,
			accessRoleId: settings.accessRoleId,
			name
		});
		channelId = channel.id;
		await activateWorldRoom(input.guildId, id, channel.id);
		return getBasecampState(input.guildId);
	} catch (error) {
		await failWorldRoom(input.guildId, id);
		if (channelId) {
			try {
				await deleteGuildChannel(channelId);
			} catch (cleanupError) {
				console.error('Orphaned Basecamp voice channel cleanup failed:', cleanupError);
			}
		}
		if (error instanceof BasecampError) throw error;
		console.error('Basecamp room creation failed:', error);
		throw new BasecampError('Discord 음성 채널을 만들지 못했습니다. 봇 권한을 확인해 주세요.');
	}
}
