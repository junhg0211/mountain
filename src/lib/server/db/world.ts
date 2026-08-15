import { getDB } from '$lib/server/db';

export interface WorldRoom {
	id: string;
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
	voiceChannelId: string | null;
	status: 'creating' | 'active' | 'failed' | 'archived';
}

export interface WorldWall {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export async function listWorldWalls(guildId: string): Promise<WorldWall[]> {
	const db = await getDB();
	const rows = await db`
		SELECT id, x, y, width, height FROM world_walls
		WHERE guild_id=${guildId} ORDER BY created_at
	`;
	return rows.map((row: Record<string, unknown>) => ({
		id: String(row.id),
		x: Number(row.x),
		y: Number(row.y),
		width: Number(row.width),
		height: Number(row.height)
	}));
}

export async function createWorldWall(input: WorldWall & { guildId: string; createdBy: string }) {
	const db = await getDB();
	await db`
		INSERT INTO world_walls (id, guild_id, x, y, width, height, created_by)
		VALUES (${input.id}, ${input.guildId}, ${input.x}, ${input.y}, ${input.width},
			${input.height}, ${input.createdBy})
	`;
}

export async function deleteWorldWall(guildId: string, id: string) {
	const db = await getDB();
	const result = await db`DELETE FROM world_walls WHERE guild_id=${guildId} AND id=${id}`;
	if (Number(result.affectedRows) !== 1) throw new Error('WALL_NOT_FOUND');
}

export async function getWorldSettings(guildId: string) {
	const db = await getDB();
	const rows = await db`
		SELECT world_category_id, world_access_role_id, world_lobby_channel_id
		FROM guild_settings WHERE guild_id=${guildId} LIMIT 1
	`;
	return {
		categoryId: rows[0]?.world_category_id ? String(rows[0].world_category_id) : null,
		accessRoleId: rows[0]?.world_access_role_id ? String(rows[0].world_access_role_id) : null,
		lobbyChannelId: rows[0]?.world_lobby_channel_id
			? String(rows[0].world_lobby_channel_id)
			: null
	};
}

export async function setWorldSettings(
	guildId: string,
	settings: { categoryId: string; accessRoleId: string; lobbyChannelId: string }
) {
	const db = await getDB();
	await db`
		INSERT INTO guild_settings (
			guild_id, world_category_id, world_access_role_id, world_lobby_channel_id
		)
		VALUES (${guildId}, ${settings.categoryId}, ${settings.accessRoleId}, ${settings.lobbyChannelId})
		ON DUPLICATE KEY UPDATE
			world_category_id=VALUES(world_category_id),
			world_access_role_id=VALUES(world_access_role_id),
			world_lobby_channel_id=VALUES(world_lobby_channel_id)
	`;
}

export async function listWorldRooms(guildId: string): Promise<WorldRoom[]> {
	const db = await getDB();
	const rows = await db`
		SELECT id, name, x, y, width, height, discord_voice_channel_id, status
		FROM world_rooms
		WHERE guild_id=${guildId} AND status <> 'archived'
		ORDER BY created_at
	`;
	return rows.map((row: Record<string, unknown>) => ({
		id: String(row.id),
		name: String(row.name),
		x: Number(row.x),
		y: Number(row.y),
		width: Number(row.width),
		height: Number(row.height),
		voiceChannelId: row.discord_voice_channel_id
			? String(row.discord_voice_channel_id)
			: null,
		status: String(row.status) as WorldRoom['status']
	}));
}

export async function createWorldRoomDraft(input: {
	id: string;
	guildId: string;
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
	createdBy: string;
}) {
	const db = await getDB();
	const conflicts = await db`
		SELECT 1 FROM world_rooms
		WHERE guild_id=${input.guildId} AND status IN ('creating', 'active')
			AND x < ${input.x + input.width} AND x + width > ${input.x}
			AND y < ${input.y + input.height} AND y + height > ${input.y}
		LIMIT 1
	`;
	if (conflicts.length) throw new Error('ROOM_OVERLAP');
	const counts = await db`
		SELECT COUNT(*) AS count FROM world_rooms
		WHERE guild_id=${input.guildId} AND status IN ('creating', 'active')
	`;
	if (Number(counts[0]?.count || 0) >= 50) throw new Error('ROOM_LIMIT');
	await db`
		INSERT INTO world_rooms (id, guild_id, name, x, y, width, height, created_by)
		VALUES (${input.id}, ${input.guildId}, ${input.name}, ${input.x}, ${input.y},
			${input.width}, ${input.height}, ${input.createdBy})
	`;
}

export async function activateWorldRoom(guildId: string, id: string, channelId: string) {
	const db = await getDB();
	await db`
		UPDATE world_rooms SET discord_voice_channel_id=${channelId}, status='active'
		WHERE guild_id=${guildId} AND id=${id} AND status='creating'
	`;
}

export async function failWorldRoom(guildId: string, id: string) {
	const db = await getDB();
	await db`
		UPDATE world_rooms SET status='failed'
		WHERE guild_id=${guildId} AND id=${id} AND status='creating'
	`;
}

export async function updateWorldRoom(input: {
	guildId: string;
	id: string;
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
}) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const rows = await tx`
			SELECT id, name, x, y, width, height, discord_voice_channel_id, status
			FROM world_rooms
			WHERE guild_id=${input.guildId} AND id=${input.id} AND status='active'
			LIMIT 1 FOR UPDATE
		`;
		if (rows.length !== 1) throw new Error('ROOM_NOT_FOUND');
		const conflicts = await tx`
			SELECT 1 FROM world_rooms
			WHERE guild_id=${input.guildId} AND id <> ${input.id}
				AND status IN ('creating', 'active')
				AND x < ${input.x + input.width} AND x + width > ${input.x}
				AND y < ${input.y + input.height} AND y + height > ${input.y}
			LIMIT 1
		`;
		if (conflicts.length) throw new Error('ROOM_OVERLAP');
		await tx`
			UPDATE world_rooms
			SET name=${input.name}, x=${input.x}, y=${input.y}, width=${input.width}, height=${input.height}
			WHERE guild_id=${input.guildId} AND id=${input.id} AND status='active'
		`;
		return {
			id: String(rows[0].id),
			name: String(rows[0].name),
			x: Number(rows[0].x),
			y: Number(rows[0].y),
			width: Number(rows[0].width),
			height: Number(rows[0].height),
			voiceChannelId: rows[0].discord_voice_channel_id
				? String(rows[0].discord_voice_channel_id)
				: null
		};
	});
}

export async function archiveWorldRoom(guildId: string, id: string) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const rows = await tx`
			SELECT discord_voice_channel_id FROM world_rooms
			WHERE guild_id=${guildId} AND id=${id} AND status='active'
			LIMIT 1 FOR UPDATE
		`;
		if (rows.length !== 1) throw new Error('ROOM_NOT_FOUND');
		await tx`
			UPDATE world_rooms SET status='archived'
			WHERE guild_id=${guildId} AND id=${id} AND status='active'
		`;
		return rows[0].discord_voice_channel_id ? String(rows[0].discord_voice_channel_id) : null;
	});
}

export async function restoreWorldRoom(guildId: string, id: string) {
	const db = await getDB();
	await db`
		UPDATE world_rooms SET status='active'
		WHERE guild_id=${guildId} AND id=${id} AND status='archived'
	`;
}
