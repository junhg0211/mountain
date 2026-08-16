import { getClient } from '$lib/server/bot';
import {
	activateWorldRoom,
	archiveWorldRoom,
	createWorldRoomDraft,
	createWorldWall,
	createWorldDoor,
	createWorldProp,
	createWorldTileType,
	deleteWorldDoor,
	deleteWorldProp,
	deleteWorldWall,
	failWorldRoom,
	getWorldProp,
	getWorldDoor,
	getWorldTileType,
	getWorldSettings,
	listWorldProps,
	listWorldDoors,
	listWorldRooms,
	listWorldTiles,
	listWorldTileTypes,
	listWorldWalls,
	moveWorldProp,
	paintWorldTiles,
	setWorldDoorOpen,
	restoreWorldRoom,
	setWorldSpawn,
	setWorldSettings,
	updateWorldRoom
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
	return botMember.id;
}

export async function getBasecampState(guildId: string) {
	const [rooms, walls, doors, tiles, tileTypes, props, settings] = await Promise.all([
		listWorldRooms(guildId),
		listWorldWalls(guildId),
		listWorldDoors(guildId),
		listWorldTiles(guildId),
		listWorldTileTypes(guildId),
		listWorldProps(guildId),
		getWorldSettings(guildId)
	]);
	return { rooms, walls, doors, tiles, tileTypes, props, settings };
}

export async function createBasecampTileType(input: {
	guildId: string;
	userId: string;
	name: string;
	imageData: string;
}) {
	await requireGuildManager(input.guildId, input.userId);
	const name = input.name.trim();
	const imageData = input.imageData.trim();
	if (!name || name.length > 40) throw new BasecampError('바닥 타일 이름은 1~40자로 입력해 주세요.');
	if (!/^[0-8]{64}$/.test(imageData) || !/[1-8]/.test(imageData))
		throw new BasecampError('8×8 편집기에 바닥 무늬를 그려 주세요.');
	await createWorldTileType({
		id: crypto.randomUUID(),
		guildId: input.guildId,
		name,
		imageData,
		createdBy: input.userId
	});
	return getBasecampState(input.guildId);
}

export async function paintBasecampTiles(input: {
	guildId: string;
	userId: string;
	tileType: string;
	cells: Array<{ x: number; y: number }>;
}) {
	await requireGuildManager(input.guildId, input.userId);
	if (input.tileType !== 'grass' && !(await getWorldTileType(input.guildId, input.tileType)))
		throw new BasecampError('이 서버에서 만든 바닥 타일을 선택해 주세요.');
	if (!Array.isArray(input.cells) || input.cells.length < 1 || input.cells.length > 2_000 ||
		!input.cells.every((cell) => Number.isInteger(cell.x) && Number.isInteger(cell.y)))
		throw new BasecampError('한 번에 1~2,000칸을 칠해 주세요.');
	const cells = [...new Map(input.cells.map((cell) => [`${cell.x}:${cell.y}`, cell])).values()];
	await paintWorldTiles({
		guildId: input.guildId,
		userId: input.userId,
		tileType: input.tileType,
		cells
	});
	return getBasecampState(input.guildId);
}

export async function createBasecampProp(input: {
	guildId: string;
	userId: string;
	name: string;
	imageData: string;
	x: number;
	y: number;
	width: number;
	height: number;
}) {
	if (!(await getGuildMember(input.guildId, input.userId)))
		throw new BasecampError('현재 Discord 서버 구성원만 소품을 놓을 수 있습니다.');
	const name = input.name.trim();
	const imageData = input.imageData.trim();
	if (!name || name.length > 40) throw new BasecampError('소품 이름은 1~40자로 입력해 주세요.');
	if (!/^[0-8]{64}$/.test(imageData) || !/[1-8]/.test(imageData))
		throw new BasecampError('8×8 편집기에 소품 이미지를 그려 주세요.');
	if (!Number.isInteger(input.x) || !Number.isInteger(input.y))
		throw new BasecampError('소품을 놓을 칸을 선택해 주세요.');
	if (!Number.isInteger(input.width) || !Number.isInteger(input.height) ||
		input.width < 1 || input.height < 1 || input.width > 32 || input.height > 32)
		throw new BasecampError('소품 크기는 1×1칸부터 32×32칸까지 설정할 수 있습니다.');
	await createWorldProp({
		id: crypto.randomUUID(),
		guildId: input.guildId,
		name,
		emoji: '📦',
		imageData,
		x: input.x,
		y: input.y,
		width: input.width,
		height: input.height,
		createdBy: input.userId
	});
	return getBasecampState(input.guildId);
}

export async function copyBasecampProp(input: {
	guildId: string;
	userId: string;
	sourceId: string;
	x: number;
	y: number;
}) {
	if (!(await getGuildMember(input.guildId, input.userId)))
		throw new BasecampError('현재 Discord 서버 구성원만 소품을 놓을 수 있습니다.');
	if (!Number.isInteger(input.x) || !Number.isInteger(input.y))
		throw new BasecampError('복사한 소품을 놓을 칸을 선택해 주세요.');
	const source = await getWorldProp(input.guildId, input.sourceId);
	if (!source) throw new BasecampError('복사할 소품을 찾을 수 없습니다.');
	await createWorldProp({
		...source,
		id: crypto.randomUUID(),
		guildId: input.guildId,
		x: input.x,
		y: input.y,
		createdBy: input.userId
	});
	return getBasecampState(input.guildId);
}

export async function deleteBasecampProp(input: { guildId: string; userId: string; id: string }) {
	const prop = await getWorldProp(input.guildId, input.id);
	if (!prop) throw new BasecampError('삭제할 소품을 찾을 수 없습니다.');
	if (prop.createdBy !== input.userId) await requireGuildManager(input.guildId, input.userId);
	await deleteWorldProp(input.guildId, input.id);
	return getBasecampState(input.guildId);
}

export async function moveBasecampProp(input: {
	guildId: string;
	userId: string;
	id: string;
	x: number;
	y: number;
}) {
	if (!Number.isInteger(input.x) || !Number.isInteger(input.y))
		throw new BasecampError('소품을 놓을 칸을 선택해 주세요.');
	const prop = await getWorldProp(input.guildId, input.id);
	if (!prop) throw new BasecampError('이동할 소품을 찾을 수 없습니다.');
	if (prop.createdBy !== input.userId) await requireGuildManager(input.guildId, input.userId);
	await moveWorldProp(input.guildId, input.id, input.x, input.y);
	return getBasecampState(input.guildId);
}

export async function configureBasecampSpawn(input: {
	guildId: string;
	userId: string;
	x: number;
	y: number;
}) {
	await requireGuildManager(input.guildId, input.userId);
	if (![input.x, input.y].every(Number.isFinite))
		throw new BasecampError('올바른 시작 위치에서 다시 시도해 주세요.');
	await setWorldSpawn(input.guildId, input.x, input.y);
	return getBasecampState(input.guildId);
}

export async function createBasecampWall(input: {
	guildId: string;
	userId: string;
	x: number;
	y: number;
	width: number;
	height: number;
	orientation: string;
}) {
	await requireGuildManager(input.guildId, input.userId);
	const horizontal = input.orientation === 'horizontal';
	if (
		![input.x, input.y, input.width, input.height].every(Number.isInteger) ||
		input.width < 1 || input.height < 1 ||
		!['horizontal', 'vertical'].includes(input.orientation) ||
		(horizontal ? input.height !== 1 : input.width !== 1)
	)
		throw new BasecampError('가로 또는 세로 벽을 그려 주세요.');
	await createWorldWall({
		...input,
		orientation: input.orientation as 'horizontal' | 'vertical',
		id: crypto.randomUUID(),
		createdBy: input.userId
	});
	return getBasecampState(input.guildId);
}

export async function deleteBasecampWall(input: { guildId: string; userId: string; id: string }) {
	await requireGuildManager(input.guildId, input.userId);
	try {
		await deleteWorldWall(input.guildId, input.id);
	} catch (error) {
		if (error instanceof Error && error.message === 'WALL_NOT_FOUND')
			throw new BasecampError('삭제할 벽을 찾을 수 없습니다.');
		throw error;
	}
	return getBasecampState(input.guildId);
}

export async function createBasecampDoor(input: {
	guildId: string;
	userId: string;
	x: number;
	y: number;
	orientation: string;
	length: number;
	password: string;
}) {
	await requireGuildManager(input.guildId, input.userId);
	if (!Number.isInteger(input.x) || !Number.isInteger(input.y) ||
		!['horizontal', 'vertical'].includes(input.orientation) ||
		!Number.isInteger(input.length) || input.length < 1 || input.length > 2)
		throw new BasecampError('격자선을 따라 1칸 또는 2칸 길이로 문을 그려 주세요.');
	if (input.password.length > 40) throw new BasecampError('문 비밀번호는 40자 이내로 설정해 주세요.');
	const passwordHash = input.password ? await Bun.password.hash(input.password) : null;
	await createWorldDoor({
		id: crypto.randomUUID(),
		guildId: input.guildId,
		x: input.x,
		y: input.y,
		orientation: input.orientation as 'horizontal' | 'vertical',
		length: input.length,
		passwordHash,
		createdBy: input.userId
	});
	return getBasecampState(input.guildId);
}

export async function openBasecampDoor(input: {
	guildId: string;
	userId: string;
	id: string;
	password: string;
}) {
	if (!(await getGuildMember(input.guildId, input.userId)))
		throw new BasecampError('현재 Discord 서버 구성원만 문을 열 수 있습니다.');
	const door = await getWorldDoor(input.guildId, input.id);
	if (!door) throw new BasecampError('열 문을 찾을 수 없습니다.');
	if (door.passwordHash && !(await Bun.password.verify(input.password, door.passwordHash)))
		throw new BasecampError('문 비밀번호가 맞지 않습니다.');
	await setWorldDoorOpen(input.guildId, input.id, true);
	return getBasecampState(input.guildId);
}

export async function closeBasecampDoor(guildId: string, id: string) {
	await setWorldDoorOpen(guildId, id, false);
	return getBasecampState(guildId);
}

export async function deleteBasecampDoor(input: { guildId: string; userId: string; id: string }) {
	await requireGuildManager(input.guildId, input.userId);
	await deleteWorldDoor(input.guildId, input.id);
	return getBasecampState(input.guildId);
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
	const botUserId = await requireBasecampBotPermissions(input.guildId, input.accessRoleId);

	const current = await getWorldSettings(input.guildId);
	let lobbyChannelId = current.lobbyChannelId;
	let createdLobbyId: string | null = null;
	if (lobbyChannelId) {
		const updated = await updateGuildVoiceChannel({
			guildId: input.guildId,
			channelId: lobbyChannelId,
			categoryId: input.categoryId,
			accessRoleId: input.accessRoleId,
			botUserId,
			name: '월드 광장',
			access: 'lobby'
		});
		if (!updated) lobbyChannelId = null;
	}
	if (!lobbyChannelId) {
		const lobby = await createGuildVoiceChannel({
			guildId: input.guildId,
			categoryId: input.categoryId,
			accessRoleId: input.accessRoleId,
			botUserId,
			name: '월드 광장',
			access: 'lobby'
		});
		lobbyChannelId = lobby.id;
		createdLobbyId = lobby.id;
	}
	try {
		const rooms = await listWorldRooms(input.guildId);
		await Promise.all(
			rooms
				.filter((room) => room.status === 'active' && room.voiceChannelId)
				.map((room) =>
					updateGuildVoiceChannel({
						guildId: input.guildId,
						channelId: room.voiceChannelId!,
						categoryId: input.categoryId,
						accessRoleId: input.accessRoleId,
						botUserId,
						name: room.name,
						access: 'room'
					})
				)
		);
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
		input.width < 2 ||
		input.height < 2
	)
		throw new BasecampError('2×2 이상의 방을 그려 주세요.');
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
	const botUserId = await requireBasecampBotPermissions(input.guildId, settings.accessRoleId);

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
			botUserId,
			name,
			access: 'room'
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

export async function updateBasecampRoom(input: {
	guildId: string;
	userId: string;
	id: string;
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
		input.width < 2 || input.height < 2
	)
		throw new BasecampError('2×2 이상의 방을 배치해 주세요.');
	const settings = await getWorldSettings(input.guildId);
	if (!settings.categoryId || !settings.accessRoleId)
		throw new BasecampError('먼저 Basecamp Discord 연결을 설정해 주세요.');
	const botUserId = await requireBasecampBotPermissions(input.guildId, settings.accessRoleId);
	let previous: Awaited<ReturnType<typeof updateWorldRoom>>;
	try {
		previous = await updateWorldRoom({ ...input, name });
	} catch (error) {
		if (error instanceof Error && error.message === 'ROOM_OVERLAP')
			throw new BasecampError('다른 방과 겹치지 않게 배치해 주세요.');
		if (error instanceof Error && error.message === 'ROOM_NOT_FOUND')
			throw new BasecampError('수정할 방을 찾을 수 없습니다.');
		throw error;
	}
	try {
		if (!previous.voiceChannelId) throw new Error('VOICE_CHANNEL_MISSING');
		const updated = await updateGuildVoiceChannel({
			guildId: input.guildId,
			channelId: previous.voiceChannelId,
			categoryId: settings.categoryId,
			accessRoleId: settings.accessRoleId,
			botUserId,
			name,
			access: 'room'
		});
		if (!updated) throw new Error('VOICE_CHANNEL_MISSING');
	} catch (error) {
		await updateWorldRoom({ guildId: input.guildId, ...previous }).catch((rollbackError) =>
			console.error('Basecamp room update rollback failed:', rollbackError)
		);
		console.error('Basecamp voice channel update failed:', error);
		throw new BasecampError('Discord 음성 채널을 수정하지 못했습니다. 변경을 되돌렸습니다.');
	}
	return getBasecampState(input.guildId);
}

export async function deleteBasecampRoom(input: { guildId: string; userId: string; id: string }) {
	await requireGuildManager(input.guildId, input.userId);
	let channelId: string | null;
	try {
		channelId = await archiveWorldRoom(input.guildId, input.id);
	} catch (error) {
		if (error instanceof Error && error.message === 'ROOM_NOT_FOUND')
			throw new BasecampError('삭제할 방을 찾을 수 없습니다.');
		throw error;
	}
	try {
		if (channelId) await deleteGuildChannel(channelId);
	} catch (error) {
		await restoreWorldRoom(input.guildId, input.id).catch((rollbackError) =>
			console.error('Basecamp room deletion rollback failed:', rollbackError)
		);
		console.error('Basecamp voice channel deletion failed:', error);
		throw new BasecampError('Discord 음성 채널을 삭제하지 못했습니다. 방을 복구했습니다.');
	}
	return getBasecampState(input.guildId);
}
