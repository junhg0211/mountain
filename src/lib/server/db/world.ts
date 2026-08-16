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
	orientation: 'horizontal' | 'vertical';
}

export interface WorldDoor {
	id: string;
	x: number;
	y: number;
	orientation: 'horizontal' | 'vertical';
	length: number;
	isOpen: boolean;
	hasPassword: boolean;
}

export interface WorldTile {
	x: number;
	y: number;
	tileType: 'stone' | 'sand' | 'water';
}

export interface WorldProp {
	id: string;
	name: string;
	emoji: string;
	imageData: string | null;
	x: number;
	y: number;
	width: number;
	height: number;
	createdBy: string;
}

export async function listWorldTiles(guildId: string): Promise<WorldTile[]> {
	const db = await getDB();
	const rows = await db`
		SELECT x, y, tile_type FROM world_tiles WHERE guild_id=${guildId}
	`;
	return rows.map((row: Record<string, unknown>) => ({
		x: Number(row.x),
		y: Number(row.y),
		tileType: String(row.tile_type) as WorldTile['tileType']
	}));
}

export async function paintWorldTiles(input: {
	guildId: string;
	userId: string;
	tileType: 'grass' | WorldTile['tileType'];
	cells: Array<{ x: number; y: number }>;
}) {
	const db = await getDB();
	await db.begin(async (tx) => {
		for (const cell of input.cells) {
			if (input.tileType === 'grass') {
				await tx`DELETE FROM world_tiles WHERE guild_id=${input.guildId} AND x=${cell.x} AND y=${cell.y}`;
			} else {
				await tx`
					INSERT INTO world_tiles (guild_id, x, y, tile_type, updated_by)
					VALUES (${input.guildId}, ${cell.x}, ${cell.y}, ${input.tileType}, ${input.userId})
					ON DUPLICATE KEY UPDATE tile_type=VALUES(tile_type), updated_by=VALUES(updated_by)
				`;
			}
		}
	});
}

export async function listWorldProps(guildId: string): Promise<WorldProp[]> {
	const db = await getDB();
	const rows = await db`
		SELECT id, name, emoji, image_data, x, y, width, height, created_by FROM world_props
		WHERE guild_id=${guildId} ORDER BY created_at
	`;
	return rows.map((row: Record<string, unknown>) => ({
		id: String(row.id),
		name: String(row.name),
		emoji: String(row.emoji),
		imageData: row.image_data ? String(row.image_data) : null,
		x: Number(row.x),
		y: Number(row.y),
		width: Number(row.width),
		height: Number(row.height),
		createdBy: String(row.created_by)
	}));
}

export async function createWorldProp(input: WorldProp & { guildId: string }) {
	const db = await getDB();
	await db`
		INSERT INTO world_props (id, guild_id, name, emoji, image_data, x, y, width, height, created_by)
		VALUES (${input.id}, ${input.guildId}, ${input.name}, ${input.emoji}, ${input.imageData}, ${input.x}, ${input.y}, ${input.width}, ${input.height}, ${input.createdBy})
	`;
}

export async function getWorldProp(guildId: string, id: string): Promise<WorldProp | null> {
	const db = await getDB();
	const rows = await db`
		SELECT id, name, emoji, image_data, x, y, width, height, created_by FROM world_props
		WHERE guild_id=${guildId} AND id=${id} LIMIT 1
	`;
	if (!rows.length) return null;
	return {
		id: String(rows[0].id),
		name: String(rows[0].name),
		emoji: String(rows[0].emoji),
		imageData: rows[0].image_data ? String(rows[0].image_data) : null,
		x: Number(rows[0].x),
		y: Number(rows[0].y),
		width: Number(rows[0].width),
		height: Number(rows[0].height),
		createdBy: String(rows[0].created_by)
	};
}

export async function deleteWorldProp(guildId: string, id: string) {
	const db = await getDB();
	const result = await db`DELETE FROM world_props WHERE guild_id=${guildId} AND id=${id}`;
	if (Number(result.affectedRows) !== 1) throw new Error('PROP_NOT_FOUND');
}

export async function moveWorldProp(guildId: string, id: string, x: number, y: number) {
	const db = await getDB();
	const result = await db`
		UPDATE world_props SET x=${x}, y=${y} WHERE guild_id=${guildId} AND id=${id}
	`;
	if (Number(result.affectedRows) !== 1) throw new Error('PROP_NOT_FOUND');
}

export async function listWorldWalls(guildId: string): Promise<WorldWall[]> {
	const db = await getDB();
	const rows = await db`
		SELECT id, x, y, width, height, orientation FROM world_walls
		WHERE guild_id=${guildId} ORDER BY created_at
	`;
	return rows.map((row: Record<string, unknown>) => ({
		id: String(row.id),
		x: Number(row.x),
		y: Number(row.y),
		width: Number(row.width),
		height: Number(row.height),
		orientation: String(row.orientation) as WorldWall['orientation']
	}));
}

export async function createWorldWall(input: WorldWall & { guildId: string; createdBy: string }) {
	const db = await getDB();
	await db`
		INSERT INTO world_walls (id, guild_id, x, y, width, height, orientation, created_by)
		VALUES (${input.id}, ${input.guildId}, ${input.x}, ${input.y}, ${input.width},
			${input.height}, ${input.orientation}, ${input.createdBy})
	`;
}

export async function deleteWorldWall(guildId: string, id: string) {
	const db = await getDB();
	const result = await db`DELETE FROM world_walls WHERE guild_id=${guildId} AND id=${id}`;
	if (Number(result.affectedRows) !== 1) throw new Error('WALL_NOT_FOUND');
}

export async function listWorldDoors(guildId: string): Promise<WorldDoor[]> {
	const db = await getDB();
	const rows = await db`
		SELECT id, x, y, orientation, length, is_open, password_hash FROM world_doors
		WHERE guild_id=${guildId} ORDER BY created_at
	`;
	return rows.map((row: Record<string, unknown>) => ({
		id: String(row.id),
		x: Number(row.x),
		y: Number(row.y),
		orientation: String(row.orientation) as WorldDoor['orientation'],
		length: Number(row.length),
		isOpen: Boolean(row.is_open),
		hasPassword: Boolean(row.password_hash)
	}));
}

export async function createWorldDoor(input: {
	id: string;
	guildId: string;
	x: number;
	y: number;
	orientation: WorldDoor['orientation'];
	length: number;
	passwordHash: string | null;
	createdBy: string;
}) {
	const db = await getDB();
	await db`
		INSERT INTO world_doors (id, guild_id, x, y, orientation, length, password_hash, created_by)
		VALUES (${input.id}, ${input.guildId}, ${input.x}, ${input.y}, ${input.orientation}, ${input.length}, ${input.passwordHash}, ${input.createdBy})
	`;
}

export async function getWorldDoor(guildId: string, id: string) {
	const db = await getDB();
	const rows = await db`
		SELECT id, password_hash, is_open FROM world_doors
		WHERE guild_id=${guildId} AND id=${id} LIMIT 1
	`;
	return rows[0] ? {
		id: String(rows[0].id),
		passwordHash: rows[0].password_hash ? String(rows[0].password_hash) : null,
		isOpen: Boolean(rows[0].is_open)
	} : null;
}

export async function setWorldDoorOpen(guildId: string, id: string, isOpen: boolean) {
	const db = await getDB();
	const result = await db`
		UPDATE world_doors SET is_open=${isOpen} WHERE guild_id=${guildId} AND id=${id}
	`;
	if (Number(result.affectedRows) !== 1) throw new Error('DOOR_NOT_FOUND');
}

export async function deleteWorldDoor(guildId: string, id: string) {
	const db = await getDB();
	const result = await db`DELETE FROM world_doors WHERE guild_id=${guildId} AND id=${id}`;
	if (Number(result.affectedRows) !== 1) throw new Error('DOOR_NOT_FOUND');
}

export async function getWorldSettings(guildId: string) {
	const db = await getDB();
	const rows = await db`
		SELECT world_category_id, world_access_role_id, world_lobby_channel_id,
			world_spawn_x, world_spawn_y
		FROM guild_settings WHERE guild_id=${guildId} LIMIT 1
	`;
	return {
		categoryId: rows[0]?.world_category_id ? String(rows[0].world_category_id) : null,
		accessRoleId: rows[0]?.world_access_role_id ? String(rows[0].world_access_role_id) : null,
		lobbyChannelId: rows[0]?.world_lobby_channel_id
			? String(rows[0].world_lobby_channel_id)
			: null,
		spawnX: Number(rows[0]?.world_spawn_x ?? 20),
		spawnY: Number(rows[0]?.world_spawn_y ?? 15)
	};
}

export async function setWorldSpawn(guildId: string, x: number, y: number) {
	const db = await getDB();
	await db`
		INSERT INTO guild_settings (guild_id, world_spawn_x, world_spawn_y)
		VALUES (${guildId}, ${x}, ${y})
		ON DUPLICATE KEY UPDATE world_spawn_x=VALUES(world_spawn_x), world_spawn_y=VALUES(world_spawn_y)
	`;
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
