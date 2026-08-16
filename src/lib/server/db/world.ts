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
	tileType: string;
	imageData: string | null;
}

export interface WorldTileType {
	id: string;
	name: string;
	imageData: string;
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
	actionType: 'teleport' | 'sign' | 'seat' | null;
	teleportX: number | null;
	teleportY: number | null;
	signText: string | null;
	createdBy: string;
}

export async function listWorldTiles(guildId: string): Promise<WorldTile[]> {
	const db = await getDB();
	const rows = await db`
		SELECT t.x, t.y, t.tile_type, d.image_data
		FROM world_tiles t
		LEFT JOIN world_tile_types d ON d.guild_id=t.guild_id AND d.id=t.tile_type
		WHERE t.guild_id=${guildId}
	`;
	return rows.map((row: Record<string, unknown>) => ({
		x: Number(row.x),
		y: Number(row.y),
		tileType: String(row.tile_type),
		imageData: row.image_data ? String(row.image_data) : null
	}));
}

export async function listWorldTileTypes(guildId: string): Promise<WorldTileType[]> {
	const db = await getDB();
	const rows = await db`
		SELECT id, name, image_data FROM world_tile_types
		WHERE guild_id=${guildId} ORDER BY created_at
	`;
	return rows.map((row: Record<string, unknown>) => ({
		id: String(row.id),
		name: String(row.name),
		imageData: String(row.image_data)
	}));
}

export async function createWorldTileType(input: {
	id: string;
	guildId: string;
	name: string;
	imageData: string;
	createdBy: string;
}) {
	const db = await getDB();
	await db`
		INSERT INTO world_tile_types (id, guild_id, name, image_data, created_by)
		VALUES (${input.id}, ${input.guildId}, ${input.name}, ${input.imageData}, ${input.createdBy})
	`;
}

export async function getWorldTileType(guildId: string, id: string) {
	const db = await getDB();
	const rows = await db`
		SELECT id FROM world_tile_types WHERE guild_id=${guildId} AND id=${id} LIMIT 1
	`;
	return rows.length ? { id: String(rows[0].id) } : null;
}

export async function deleteWorldTileType(guildId: string, id: string) {
	const db = await getDB();
	return db.begin(async (tx) => {
		await tx`DELETE FROM world_tiles WHERE guild_id=${guildId} AND tile_type=${id}`;
		const result = await tx`DELETE FROM world_tile_types WHERE guild_id=${guildId} AND id=${id}`;
		if (Number(result.affectedRows) !== 1) throw new Error('TILE_TYPE_NOT_FOUND');
	});
}

export async function paintWorldTiles(input: {
	guildId: string;
	userId: string;
	tileType: string;
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
		SELECT id, name, emoji, image_data, x, y, width, height, action_type, teleport_x, teleport_y, sign_text, created_by FROM world_props
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
		actionType: row.action_type === 'teleport' || row.action_type === 'sign' || row.action_type === 'seat' ? row.action_type : null,
		teleportX: row.teleport_x === null ? null : Number(row.teleport_x),
		teleportY: row.teleport_y === null ? null : Number(row.teleport_y),
		signText: row.sign_text === null ? null : String(row.sign_text),
		createdBy: String(row.created_by)
	}));
}

export async function createWorldProp(input: WorldProp & { guildId: string }) {
	const db = await getDB();
	await db`
		INSERT INTO world_props (id, guild_id, name, emoji, image_data, x, y, width, height, action_type, teleport_x, teleport_y, sign_text, created_by)
		VALUES (${input.id}, ${input.guildId}, ${input.name}, ${input.emoji}, ${input.imageData}, ${input.x}, ${input.y}, ${input.width}, ${input.height}, ${input.actionType}, ${input.teleportX}, ${input.teleportY}, ${input.signText}, ${input.createdBy})
	`;
}

export async function getWorldProp(guildId: string, id: string): Promise<WorldProp | null> {
	const db = await getDB();
	const rows = await db`
		SELECT id, name, emoji, image_data, x, y, width, height, action_type, teleport_x, teleport_y, sign_text, created_by FROM world_props
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
		actionType: rows[0].action_type === 'teleport' || rows[0].action_type === 'sign' || rows[0].action_type === 'seat' ? rows[0].action_type : null,
		teleportX: rows[0].teleport_x === null ? null : Number(rows[0].teleport_x),
		teleportY: rows[0].teleport_y === null ? null : Number(rows[0].teleport_y),
		signText: rows[0].sign_text === null ? null : String(rows[0].sign_text),
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

export async function updateWorldProp(input: {
	guildId: string;
	id: string;
	name: string;
	imageData: string;
	width: number;
	height: number;
	actionType: WorldProp['actionType'];
	teleportX: number | null;
	teleportY: number | null;
	signText: string | null;
}) {
	const db = await getDB();
	await db`
		UPDATE world_props SET name=${input.name}, image_data=${input.imageData},
			width=${input.width}, height=${input.height}, action_type=${input.actionType},
			teleport_x=${input.teleportX}, teleport_y=${input.teleportY}, sign_text=${input.signText}
		WHERE guild_id=${input.guildId} AND id=${input.id}
	`;
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

export async function mergeWorldWall(input: WorldWall & { guildId: string; createdBy: string }) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const horizontal = input.orientation === 'horizontal';
		const fixed = horizontal ? input.y : input.x;
		let start = horizontal ? input.x : input.y;
		let end = start + (horizontal ? input.width : input.height);
		const doors = await tx`
			SELECT x, y, length FROM world_doors
			WHERE guild_id=${input.guildId} AND orientation=${input.orientation}
			FOR UPDATE
		`;
		if ((doors as Array<Record<string, unknown>>).some((door) => {
			if (Number(horizontal ? door.y : door.x) !== fixed) return false;
			const doorStart = Number(horizontal ? door.x : door.y);
			return doorStart < end && doorStart + Number(door.length) > start;
		})) return false;
		const rows = await tx`
			SELECT id, x, y, width, height FROM world_walls
			WHERE guild_id=${input.guildId} AND orientation=${input.orientation}
			FOR UPDATE
		`;
		const mergedIds = new Set<string>();
		let expanded = true;
		while (expanded) {
			expanded = false;
			for (const row of rows as Array<Record<string, unknown>>) {
				const id = String(row.id);
				if (mergedIds.has(id) || Number(horizontal ? row.y : row.x) !== fixed) continue;
				const wallStart = Number(horizontal ? row.x : row.y);
				const wallEnd = wallStart + Number(horizontal ? row.width : row.height);
				if (wallEnd < start || wallStart > end) continue;
				mergedIds.add(id);
				start = Math.min(start, wallStart);
				end = Math.max(end, wallEnd);
				expanded = true;
			}
		}
		for (const id of mergedIds)
			await tx`DELETE FROM world_walls WHERE guild_id=${input.guildId} AND id=${id}`;
		await tx`
			INSERT INTO world_walls (id, guild_id, x, y, width, height, orientation, created_by)
			VALUES (${input.id}, ${input.guildId}, ${horizontal ? start : fixed},
				${horizontal ? fixed : start}, ${horizontal ? end - start : 1},
				${horizontal ? 1 : end - start}, ${input.orientation}, ${input.createdBy})
		`;
		return true;
	});
}

export async function cutWorldWalls(input: Omit<WorldWall, 'id'> & { guildId: string }) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const horizontal = input.orientation === 'horizontal';
		const fixed = horizontal ? input.y : input.x;
		const cutStart = horizontal ? input.x : input.y;
		const cutEnd = cutStart + (horizontal ? input.width : input.height);
		const rows = await tx`
			SELECT id, x, y, width, height, created_by FROM world_walls
			WHERE guild_id=${input.guildId} AND orientation=${input.orientation}
			FOR UPDATE
		`;
		let cutCount = 0;
		for (const row of rows as Array<Record<string, unknown>>) {
			if (Number(horizontal ? row.y : row.x) !== fixed) continue;
			const wallStart = Number(horizontal ? row.x : row.y);
			const wallEnd = wallStart + Number(horizontal ? row.width : row.height);
			const overlapStart = Math.max(wallStart, cutStart);
			const overlapEnd = Math.min(wallEnd, cutEnd);
			if (overlapEnd <= overlapStart) continue;
			await tx`DELETE FROM world_walls WHERE guild_id=${input.guildId} AND id=${String(row.id)}`;
			cutCount += 1;
			for (const [fragmentStart, fragmentEnd] of [[wallStart, overlapStart], [overlapEnd, wallEnd]]) {
				if (fragmentEnd <= fragmentStart) continue;
				await tx`
					INSERT INTO world_walls (id, guild_id, x, y, width, height, orientation, created_by)
					VALUES (${crypto.randomUUID()}, ${input.guildId}, ${horizontal ? fragmentStart : fixed},
						${horizontal ? fixed : fragmentStart}, ${horizontal ? fragmentEnd - fragmentStart : 1},
						${horizontal ? 1 : fragmentEnd - fragmentStart}, ${input.orientation}, ${String(row.created_by)})
				`;
			}
		}
		return cutCount;
	});
}

export async function copyWorldRegion(input: {
	guildId: string;
	userId: string;
	x: number;
	y: number;
	width: number;
	height: number;
	targetX: number;
	targetY: number;
}) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const xEnd = input.x + input.width;
		const yEnd = input.y + input.height;
		const [tiles, props, doors, allWalls] = await Promise.all([
			tx`SELECT x, y, tile_type FROM world_tiles WHERE guild_id=${input.guildId} AND x>=${input.x} AND x<${xEnd} AND y>=${input.y} AND y<${yEnd}`,
			tx`SELECT name, emoji, image_data, x, y, width, height, action_type, teleport_x, teleport_y, sign_text FROM world_props WHERE guild_id=${input.guildId} AND x>=${input.x} AND x+width<=${xEnd} AND y>=${input.y} AND y+height<=${yEnd}`,
			tx`SELECT x, y, orientation, length, password_hash FROM world_doors WHERE guild_id=${input.guildId} FOR UPDATE`,
			tx`SELECT x, y, width, height, orientation, created_by FROM world_walls WHERE guild_id=${input.guildId} FOR UPDATE`
		]);
		const offsetX = input.targetX - input.x;
		const offsetY = input.targetY - input.y;
		await tx`
			DELETE FROM world_tiles WHERE guild_id=${input.guildId}
				AND x>=${input.targetX} AND x<${input.targetX + input.width}
				AND y>=${input.targetY} AND y<${input.targetY + input.height}
		`;
		for (const row of tiles as Array<Record<string, unknown>>)
			await tx`
				INSERT INTO world_tiles (guild_id, x, y, tile_type, updated_by)
				VALUES (${input.guildId}, ${Number(row.x) + offsetX}, ${Number(row.y) + offsetY}, ${String(row.tile_type)}, ${input.userId})
				ON DUPLICATE KEY UPDATE tile_type=VALUES(tile_type), updated_by=VALUES(updated_by)
			`;
		for (const row of props as Array<Record<string, unknown>>) {
			const teleportX = row.teleport_x === null ? null : Number(row.teleport_x);
			const teleportY = row.teleport_y === null ? null : Number(row.teleport_y);
			const moveTeleport = teleportX !== null && teleportY !== null &&
				teleportX >= input.x && teleportX < xEnd && teleportY >= input.y && teleportY < yEnd;
			await tx`
				INSERT INTO world_props (id, guild_id, name, emoji, image_data, x, y, width, height,
					action_type, teleport_x, teleport_y, sign_text, created_by)
				VALUES (${crypto.randomUUID()}, ${input.guildId}, ${String(row.name)}, ${String(row.emoji)},
					${row.image_data === null ? null : String(row.image_data)}, ${Number(row.x) + offsetX},
					${Number(row.y) + offsetY}, ${Number(row.width)}, ${Number(row.height)},
					${row.action_type === null ? null : String(row.action_type)},
					${moveTeleport ? teleportX! + offsetX : teleportX},
					${moveTeleport ? teleportY! + offsetY : teleportY},
					${row.sign_text === null ? null : String(row.sign_text)}, ${input.userId})
			`;
		}
		const selectedDoors = (doors as Array<Record<string, unknown>>).filter((row) => {
			const horizontal = String(row.orientation) === 'horizontal';
			const x = Number(row.x);
			const y = Number(row.y);
			const length = Number(row.length);
			return horizontal
				? y >= input.y && y <= yEnd && x >= input.x && x + length <= xEnd
				: x >= input.x && x <= xEnd && y >= input.y && y + length <= yEnd;
		});
		for (const row of selectedDoors)
			await tx`
				INSERT INTO world_doors (id, guild_id, x, y, orientation, length, password_hash, created_by)
				VALUES (${crypto.randomUUID()}, ${input.guildId}, ${Number(row.x) + offsetX},
					${Number(row.y) + offsetY}, ${String(row.orientation)}, ${Number(row.length)},
					${row.password_hash === null ? null : String(row.password_hash)}, ${input.userId})
			`;
		const selectedWalls = (allWalls as Array<Record<string, unknown>>).filter((row) => {
			const horizontal = String(row.orientation) === 'horizontal';
			const x = Number(row.x);
			const y = Number(row.y);
			return horizontal
				? y >= input.y && y <= yEnd && x >= input.x && x + Number(row.width) <= xEnd
				: x >= input.x && x <= xEnd && y >= input.y && y + Number(row.height) <= yEnd;
		});
		if (selectedWalls.length > 0) {
			type WallSegment = {
				orientation: 'horizontal' | 'vertical';
				fixed: number;
				start: number;
				end: number;
				createdBy: string;
			};
			const segments: WallSegment[] = (allWalls as Array<Record<string, unknown>>).map((row) => {
				const horizontal = String(row.orientation) === 'horizontal';
				return {
					orientation: horizontal ? 'horizontal' : 'vertical',
					fixed: Number(horizontal ? row.y : row.x),
					start: Number(horizontal ? row.x : row.y),
					end: Number(horizontal ? row.x : row.y) + Number(horizontal ? row.width : row.height),
					createdBy: String(row.created_by)
				};
			});
			for (const row of selectedWalls) {
				const horizontal = String(row.orientation) === 'horizontal';
				const start = Number(horizontal ? row.x : row.y) + (horizontal ? offsetX : offsetY);
				segments.push({
					orientation: horizontal ? 'horizontal' : 'vertical',
					fixed: Number(horizontal ? row.y : row.x) + (horizontal ? offsetY : offsetX),
					start,
					end: start + Number(horizontal ? row.width : row.height),
					createdBy: input.userId
				});
			}
			const groups = new Map<string, WallSegment[]>();
			for (const segment of segments) {
				const key = `${segment.orientation}:${segment.fixed}`;
				groups.set(key, [...(groups.get(key) ?? []), segment]);
			}
			const merged: WallSegment[] = [];
			for (const group of groups.values()) {
				group.sort((left, right) => left.start - right.start || left.end - right.end);
				for (const segment of group) {
					const previous = merged.at(-1);
					if (previous && previous.orientation === segment.orientation && previous.fixed === segment.fixed && segment.start <= previous.end)
						previous.end = Math.max(previous.end, segment.end);
					else merged.push({ ...segment });
				}
			}
			await tx`DELETE FROM world_walls WHERE guild_id=${input.guildId}`;
			for (const segment of merged) {
				const horizontal = segment.orientation === 'horizontal';
				await tx`
					INSERT INTO world_walls (id, guild_id, x, y, width, height, orientation, created_by)
					VALUES (${crypto.randomUUID()}, ${input.guildId}, ${horizontal ? segment.start : segment.fixed},
						${horizontal ? segment.fixed : segment.start}, ${horizontal ? segment.end - segment.start : 1},
						${horizontal ? 1 : segment.end - segment.start}, ${segment.orientation}, ${segment.createdBy})
				`;
			}
		}
		return {
			tiles: input.width * input.height,
			props: props.length,
			doors: selectedDoors.length,
			walls: selectedWalls.length
		};
	});
}

export async function deleteWorldRegion(input: {
	guildId: string;
	x: number;
	y: number;
	width: number;
	height: number;
}) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const xEnd = input.x + input.width;
		const yEnd = input.y + input.height;
		await tx`DELETE FROM world_tiles WHERE guild_id=${input.guildId} AND x>=${input.x} AND x<${xEnd} AND y>=${input.y} AND y<${yEnd}`;
		const props = await tx`DELETE FROM world_props WHERE guild_id=${input.guildId} AND x>=${input.x} AND x+width<=${xEnd} AND y>=${input.y} AND y+height<=${yEnd}`;
		const doors = await tx`
			DELETE FROM world_doors WHERE guild_id=${input.guildId} AND (
				(orientation='horizontal' AND y>=${input.y} AND y<=${yEnd} AND x>=${input.x} AND x+length<=${xEnd}) OR
				(orientation='vertical' AND x>=${input.x} AND x<=${xEnd} AND y>=${input.y} AND y+length<=${yEnd})
			)
		`;
		const walls = await tx`
			DELETE FROM world_walls WHERE guild_id=${input.guildId} AND (
				(orientation='horizontal' AND y>=${input.y} AND y<=${yEnd} AND x>=${input.x} AND x+width<=${xEnd}) OR
				(orientation='vertical' AND x>=${input.x} AND x<=${xEnd} AND y>=${input.y} AND y+height<=${yEnd})
			)
		`;
		return {
			tiles: input.width * input.height, props: Number(props.affectedRows),
			doors: Number(doors.affectedRows), walls: Number(walls.affectedRows)
		};
	});
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
	await db.begin(async (tx) => {
		const horizontal = input.orientation === 'horizontal';
		const fixed = horizontal ? input.y : input.x;
		const doorStart = horizontal ? input.x : input.y;
		const doorEnd = doorStart + input.length;
		const walls = await tx`
			SELECT id, x, y, width, height, created_by FROM world_walls
			WHERE guild_id=${input.guildId} AND orientation=${input.orientation}
			FOR UPDATE
		`;
		for (const wall of walls as Array<Record<string, unknown>>) {
			if (Number(horizontal ? wall.y : wall.x) !== fixed) continue;
			const wallStart = Number(horizontal ? wall.x : wall.y);
			const wallEnd = wallStart + Number(horizontal ? wall.width : wall.height);
			if (wallEnd <= doorStart || wallStart >= doorEnd) continue;
			await tx`DELETE FROM world_walls WHERE guild_id=${input.guildId} AND id=${String(wall.id)}`;
			for (const [start, end] of [[wallStart, Math.min(wallEnd, doorStart)], [Math.max(wallStart, doorEnd), wallEnd]]) {
				if (end <= start) continue;
				await tx`
					INSERT INTO world_walls (id, guild_id, x, y, width, height, orientation, created_by)
					VALUES (${crypto.randomUUID()}, ${input.guildId}, ${horizontal ? start : fixed},
						${horizontal ? fixed : start}, ${horizontal ? end - start : 1},
						${horizontal ? 1 : end - start}, ${input.orientation}, ${String(wall.created_by)})
				`;
			}
		}
		await tx`
			INSERT INTO world_doors (id, guild_id, x, y, orientation, length, password_hash, created_by)
			VALUES (${input.id}, ${input.guildId}, ${input.x}, ${input.y}, ${input.orientation}, ${input.length}, ${input.passwordHash}, ${input.createdBy})
		`;
	});
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
