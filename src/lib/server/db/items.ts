import { getDB } from '$lib/server/db';
import { centsToMoney, moneyToCents, parseMoney } from '$lib/server/economy/money';

export const ITEM_TYPES = ['consumable', 'collectible', 'box', 'role', 'coupon'] as const;
export const ITEM_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export const ITEM_EFFECT_TYPES = ['currency', 'discord_role', 'random_box', 'coupon'] as const;
export const ITEM_MOVEMENT_TYPES = [
	'grant',
	'purchase',
	'use',
	'discard',
	'transfer_in',
	'transfer_out',
	'refund',
	'expire',
	'revoke'
] as const;

export type ItemType = (typeof ITEM_TYPES)[number];
export type ItemRarity = (typeof ITEM_RARITIES)[number];
export type ItemEffectType = (typeof ITEM_EFFECT_TYPES)[number];
export type ItemMovementType = (typeof ITEM_MOVEMENT_TYPES)[number];
export type ItemEffect =
	| { type: 'currency'; amount: string }
	| { type: 'discord_role'; roleId: string; durationSeconds: number | null }
	| { type: 'random_box'; lootTableId: string }
	| { type: 'coupon'; action: string };
export type ItemDefinitionInput = {
	key: string;
	name: string;
	description?: string;
	type: ItemType;
	rarity?: ItemRarity;
	iconEmoji: string;
	stackable?: boolean;
	maxStack?: number | null;
	tradable?: boolean;
	usable?: boolean;
	consumedOnUse?: boolean;
	purchasePrice?: string | null;
	sellPrice?: string | null;
	effect?: ItemEffect | null;
	active?: boolean;
};
export type ItemDefinition = ReturnType<typeof mapItem>;

export class ItemNotFoundError extends Error {}
export class InsufficientItemQuantityError extends Error {}
export class ItemStackLimitError extends Error {}
export class ItemNotUsableError extends Error {}

export async function createItemDefinition(guildId: string, input: ItemDefinitionInput) {
	const item = validateDefinition(input);
	const db = await getDB();
	const result = await db`
		INSERT INTO items (
			guild_id, item_key, name, description, item_type, rarity, icon_emoji,
			stackable, max_stack, tradable, usable, consumed_on_use,
			purchase_price, sell_price, effect_type, effect_config, active
		) VALUES (
			${guildId}, ${item.key}, ${item.name}, ${item.description}, ${item.type},
			${item.rarity}, ${item.iconEmoji}, ${item.stackable}, ${item.maxStack},
			${item.tradable}, ${item.usable}, ${item.consumedOnUse},
			${item.purchasePrice}, ${item.sellPrice}, ${item.effect?.type ?? null},
			${item.effect ? JSON.stringify(effectConfig(item.effect)) : null}, ${item.active}
		)
	`;
	return getItemDefinition(guildId, String(result.lastInsertRowid));
}

export async function updateItemDefinition(
	guildId: string,
	itemId: string,
	input: ItemDefinitionInput
) {
	const item = validateDefinition(input);
	const db = await getDB();
	await db.begin(async (tx) => {
		const existing =
			await tx`SELECT id FROM items WHERE guild_id=${guildId} AND id=${itemId} FOR UPDATE`;
		if (existing.length !== 1) throw new ItemNotFoundError('Item definition was not found.');
		const inventoryRows =
			await tx`SELECT COALESCE(MAX(quantity), 0) AS largest_stack FROM inventories WHERE guild_id=${guildId} AND item_id=${itemId} FOR UPDATE`;
		const largestStack = Number(inventoryRows[0]?.largest_stack ?? 0);
		const nextLimit = item.stackable ? item.maxStack : 1;
		if (nextLimit !== null && largestStack > nextLimit) throw new ItemStackLimitError();
		await tx`
			UPDATE items SET item_key=${item.key}, name=${item.name}, description=${item.description},
				item_type=${item.type}, rarity=${item.rarity}, icon_emoji=${item.iconEmoji},
				stackable=${item.stackable}, max_stack=${item.maxStack}, tradable=${item.tradable},
				usable=${item.usable}, consumed_on_use=${item.consumedOnUse},
				purchase_price=${item.purchasePrice}, sell_price=${item.sellPrice},
				effect_type=${item.effect?.type ?? null},
				effect_config=${item.effect ? JSON.stringify(effectConfig(item.effect)) : null},
				active=${item.active}
			WHERE guild_id=${guildId} AND id=${itemId}
		`;
	});
	return getItemDefinition(guildId, itemId);
}

export async function getItemDefinition(guildId: string, itemId: string) {
	const db = await getDB();
	const rows = await db`SELECT * FROM items WHERE guild_id=${guildId} AND id=${itemId} LIMIT 1`;
	if (rows.length !== 1) throw new ItemNotFoundError('Item definition was not found.');
	return mapItem(rows[0] as Record<string, unknown>);
}

export async function getItemDefinitionByKey(guildId: string, itemKey: string) {
	const db = await getDB();
	const rows =
		await db`SELECT * FROM items WHERE guild_id=${guildId} AND item_key=${itemKey} LIMIT 1`;
	if (rows.length !== 1) throw new ItemNotFoundError('Item definition was not found.');
	return mapItem(rows[0] as Record<string, unknown>);
}

export async function listItemDefinitions(guildId: string, includeInactive = false) {
	const db = await getDB();
	const rows = includeInactive
		? await db`SELECT * FROM items WHERE guild_id=${guildId} ORDER BY name, id`
		: await db`SELECT * FROM items WHERE guild_id=${guildId} AND active=TRUE ORDER BY name, id`;
	return rows.map((row: Record<string, unknown>) => mapItem(row));
}

export async function getInventory(guildId: string, userId: string) {
	const db = await getDB();
	const rows = await db`
		SELECT items.*, inventories.quantity, inventories.updated_at AS inventory_updated_at
		FROM inventories
		JOIN items ON items.guild_id=inventories.guild_id AND items.id=inventories.item_id
		WHERE inventories.guild_id=${guildId} AND inventories.user_id=${userId}
		ORDER BY items.name, items.id
	`;
	return rows.map((row: Record<string, unknown>) => ({
		item: mapItem(row),
		quantity: Number(row.quantity),
		updatedAt: toIso(row.inventory_updated_at)
	}));
}

export async function changeInventoryQuantity(options: {
	guildId: string;
	userId: string;
	itemId: string;
	delta: number;
	type: ItemMovementType;
	referenceType?: string | null;
	referenceId?: string | null;
}) {
	validateQuantityDelta(options.delta);
	if (!ITEM_MOVEMENT_TYPES.includes(options.type))
		throw new TypeError('Unsupported item movement type.');
	validateMovementDirection(options.type, options.delta);
	validateReference(options.referenceType, 32, 'referenceType');
	validateReference(options.referenceId, 64, 'referenceId');
	const db = await getDB();
	return db.begin(async (tx) => {
		const itemRows = await tx`
			SELECT stackable, max_stack FROM items
			WHERE guild_id=${options.guildId} AND id=${options.itemId} FOR UPDATE
		`;
		if (itemRows.length !== 1) throw new ItemNotFoundError('Item definition was not found.');
		const inventoryRows = await tx`
			SELECT quantity FROM inventories
			WHERE guild_id=${options.guildId} AND user_id=${options.userId} AND item_id=${options.itemId}
			FOR UPDATE
		`;
		const current = inventoryRows.length === 1 ? Number(inventoryRows[0].quantity) : 0;
		const next = current + options.delta;
		if (!Number.isSafeInteger(next) || next < 0) throw new InsufficientItemQuantityError();
		const stackLimit = Boolean(itemRows[0].stackable)
			? itemRows[0].max_stack == null
				? null
				: Number(itemRows[0].max_stack)
			: 1;
		if (stackLimit !== null && next > stackLimit) throw new ItemStackLimitError();
		if (next === 0) {
			await tx`DELETE FROM inventories WHERE guild_id=${options.guildId} AND user_id=${options.userId} AND item_id=${options.itemId}`;
		} else if (inventoryRows.length === 1) {
			await tx`UPDATE inventories SET quantity=${next} WHERE guild_id=${options.guildId} AND user_id=${options.userId} AND item_id=${options.itemId}`;
		} else {
			await tx`INSERT INTO inventories (guild_id, user_id, item_id, quantity) VALUES (${options.guildId}, ${options.userId}, ${options.itemId}, ${next})`;
		}
		await tx`
			INSERT INTO item_movements (
				guild_id, user_id, item_id, quantity_delta, movement_type, reference_type, reference_id
			) VALUES (${options.guildId}, ${options.userId}, ${options.itemId}, ${options.delta},
				${options.type}, ${options.referenceType ?? null}, ${options.referenceId ?? null})
		`;
		return next;
	});
}

export async function getItemMovements(guildId: string, userId: string, limit = 50) {
	const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
	const db = await getDB();
	const rows = await db`
		SELECT item_movements.id, item_movements.item_id, item_movements.quantity_delta,
			item_movements.movement_type, item_movements.reference_type,
			item_movements.reference_id, item_movements.created_at,
			items.item_key, items.name, items.icon_emoji
		FROM item_movements
		JOIN items ON items.guild_id=item_movements.guild_id AND items.id=item_movements.item_id
		WHERE item_movements.guild_id=${guildId} AND item_movements.user_id=${userId}
		ORDER BY item_movements.created_at DESC, item_movements.id DESC LIMIT ${safeLimit}
	`;
	return rows.map((row: Record<string, unknown>) => ({
		id: String(row.id),
		item: {
			id: String(row.item_id),
			key: String(row.item_key),
			name: String(row.name),
			iconEmoji: String(row.icon_emoji)
		},
		quantityDelta: Number(row.quantity_delta),
		type: String(row.movement_type) as ItemMovementType,
		referenceType: row.reference_type == null ? null : String(row.reference_type),
		referenceId: row.reference_id == null ? null : String(row.reference_id),
		createdAt: toIso(row.created_at)
	}));
}

export async function useCurrencyItem(guildId: string, userId: string, itemId: string) {
	const useId = crypto.randomUUID();
	const db = await getDB();
	return db.begin(async (tx) => {
		const itemRows = await tx`
			SELECT name, icon_emoji, active, usable, consumed_on_use, effect_type, effect_config
			FROM items WHERE guild_id=${guildId} AND id=${itemId} FOR UPDATE
		`;
		if (itemRows.length !== 1) throw new ItemNotFoundError('Item definition was not found.');
		const item = itemRows[0] as Record<string, unknown>;
		if (!Boolean(item.active) || !Boolean(item.usable) || !Boolean(item.consumed_on_use)) {
			throw new ItemNotUsableError('Item cannot be used.');
		}
		if (String(item.effect_type) !== 'currency') {
			throw new ItemNotUsableError('Item effect is not supported.');
		}
		const effectConfig = parseJsonObject(item.effect_config);
		const reward = parseMoney(String(effectConfig.amount ?? ''));
		if (!reward) throw new ItemNotUsableError('Item reward is invalid.');

		const inventoryRows = await tx`
			SELECT quantity FROM inventories
			WHERE guild_id=${guildId} AND user_id=${userId} AND item_id=${itemId} FOR UPDATE
		`;
		if (inventoryRows.length !== 1 || Number(inventoryRows[0].quantity) < 1) {
			throw new InsufficientItemQuantityError();
		}
		const remainingQuantity = Number(inventoryRows[0].quantity) - 1;
		await tx`INSERT IGNORE INTO accounts (guild_id, user_id) VALUES (${guildId}, ${userId})`;
		const accountRows =
			await tx`SELECT balance FROM accounts WHERE guild_id=${guildId} AND user_id=${userId} FOR UPDATE`;
		if (accountRows.length !== 1) throw new Error('Account could not be loaded.');
		const nextBalance =
			moneyToCents(formatMoneyValue(accountRows[0].balance)) + moneyToCents(reward);

		await tx`
			INSERT INTO item_uses (
				id, guild_id, user_id, item_id, quantity, status, effect_type, effect_config
			) VALUES (${useId}, ${guildId}, ${userId}, ${itemId}, 1, 'pending', 'currency', ${JSON.stringify(effectConfig)})
		`;
		if (remainingQuantity === 0) {
			await tx`DELETE FROM inventories WHERE guild_id=${guildId} AND user_id=${userId} AND item_id=${itemId}`;
		} else {
			await tx`UPDATE inventories SET quantity=${remainingQuantity} WHERE guild_id=${guildId} AND user_id=${userId} AND item_id=${itemId}`;
		}
		await tx`
			INSERT INTO item_movements (
				guild_id, user_id, item_id, quantity_delta, movement_type, reference_type, reference_id
			) VALUES (${guildId}, ${userId}, ${itemId}, -1, 'use', 'item_use', ${useId})
		`;
		await tx`UPDATE accounts SET balance=${centsToMoney(nextBalance)} WHERE guild_id=${guildId} AND user_id=${userId}`;
		await tx`
			INSERT INTO transactions (
				guild_id, sender_id, recipient_id, amount, transaction_type, item_use_id
			) VALUES (${guildId}, ${null}, ${userId}, ${reward}, 'item_use', ${useId})
		`;
		await tx`UPDATE item_uses SET status='completed', completed_at=CURRENT_TIMESTAMP WHERE id=${useId}`;
		return {
			useId,
			item: { id: itemId, name: String(item.name), iconEmoji: String(item.icon_emoji) },
			reward,
			balance: centsToMoney(nextBalance),
			remainingQuantity
		};
	});
}

function validateDefinition(input: ItemDefinitionInput) {
	const key = input.key.trim(),
		name = input.name.trim(),
		description = (input.description ?? '').trim();
	if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(key))
		throw new TypeError(
			'Item key must be 2-64 lowercase letters, numbers, underscores, or hyphens.'
		);
	if (name.length < 1 || name.length > 80)
		throw new TypeError('Item name must be 1-80 characters.');
	if (description.length < 1 || description.length > 500)
		throw new TypeError('Item description must be 1-500 characters.');
	if (!ITEM_TYPES.includes(input.type)) throw new TypeError('Unsupported item type.');
	const rarity = input.rarity ?? 'common';
	if (!ITEM_RARITIES.includes(rarity)) throw new TypeError('Unsupported item rarity.');
	const stackable = input.stackable ?? true,
		maxStack = input.maxStack ?? null;
	if (maxStack !== null && (!Number.isSafeInteger(maxStack) || maxStack < 1))
		throw new TypeError('Maximum stack must be a positive integer.');
	if (!stackable && maxStack !== null && maxStack !== 1)
		throw new TypeError('A non-stackable item may only have a maximum stack of 1.');
	const iconEmoji = input.iconEmoji.trim();
	if (!isSingleEmoji(iconEmoji)) throw new TypeError('Item icon must be a single emoji.');
	const purchasePrice = validateOptionalMoney(input.purchasePrice, 'purchase price');
	const sellPrice = validateOptionalMoney(input.sellPrice, 'sell price');
	if (input.effect) validateEffect(input.effect);
	return {
		key,
		name,
		description,
		type: input.type,
		rarity,
		iconEmoji,
		stackable,
		maxStack: stackable ? maxStack : 1,
		tradable: input.tradable ?? false,
		usable: input.usable ?? false,
		consumedOnUse: input.consumedOnUse ?? true,
		purchasePrice,
		sellPrice,
		effect: input.effect ?? null,
		active: input.active ?? true
	};
}

function validateEffect(effect: ItemEffect): void {
	if (!ITEM_EFFECT_TYPES.includes(effect.type)) throw new TypeError('Unsupported item effect.');
	if (effect.type === 'currency' && parseMoney(effect.amount) === null)
		throw new TypeError(
			'Currency effect amount must be a positive amount with at most two decimals.'
		);
	if (effect.type === 'discord_role') {
		if (!/^\d{1,255}$/.test(effect.roleId)) throw new TypeError('Discord role ID is invalid.');
		if (
			effect.durationSeconds !== null &&
			(!Number.isSafeInteger(effect.durationSeconds) || effect.durationSeconds < 1)
		)
			throw new TypeError('Role duration must be a positive number of seconds.');
	}
	if (effect.type === 'random_box' && !/^\d+$/.test(effect.lootTableId))
		throw new TypeError('Loot table ID is invalid.');
	if (effect.type === 'coupon' && !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(effect.action))
		throw new TypeError('Coupon action is invalid.');
}

function validateOptionalMoney(value: string | null | undefined, label: string): string | null {
	if (value == null || value.trim() === '') return null;
	const parsed = parseMoney(value);
	if (parsed === null)
		throw new TypeError(`Item ${label} must be positive with at most two decimals.`);
	return parsed;
}
function effectConfig(effect: ItemEffect): Omit<ItemEffect, 'type'> {
	const { type: _type, ...config } = effect;
	return config;
}
function mapItem(row: Record<string, unknown>) {
	const effectType = row.effect_type == null ? null : (String(row.effect_type) as ItemEffectType);
	const config = parseJsonObject(row.effect_config);
	return {
		id: String(row.id),
		guildId: String(row.guild_id),
		key: String(row.item_key),
		name: String(row.name),
		description: String(row.description),
		type: String(row.item_type) as ItemType,
		rarity: String(row.rarity) as ItemRarity,
		iconEmoji: String(row.icon_emoji),
		stackable: Boolean(row.stackable),
		maxStack: row.max_stack == null ? null : Number(row.max_stack),
		tradable: Boolean(row.tradable),
		usable: Boolean(row.usable),
		consumedOnUse: Boolean(row.consumed_on_use),
		purchasePrice: formatOptionalMoney(row.purchase_price),
		sellPrice: formatOptionalMoney(row.sell_price),
		effect: effectType ? ({ type: effectType, ...config } as ItemEffect) : null,
		active: Boolean(row.active),
		createdAt: toIso(row.created_at),
		updatedAt: toIso(row.updated_at)
	};
}
function parseJsonObject(value: unknown): Record<string, unknown> {
	if (value == null) return {};
	const parsed = typeof value === 'string' ? JSON.parse(value) : value;
	return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
		? (parsed as Record<string, unknown>)
		: {};
}
function formatOptionalMoney(value: unknown): string | null {
	if (value == null) return null;
	const [integer, fraction = ''] = String(value).split('.');
	return `${integer}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}
function formatMoneyValue(value: unknown): string {
	return formatOptionalMoney(value) ?? '0.00';
}
function validateQuantityDelta(delta: number): void {
	if (!Number.isSafeInteger(delta) || delta === 0)
		throw new TypeError('Inventory quantity delta must be a non-zero safe integer.');
}
function validateMovementDirection(type: ItemMovementType, delta: number): void {
	const credits: readonly ItemMovementType[] = ['grant', 'purchase', 'transfer_in', 'refund'];
	if (credits.includes(type) !== delta > 0) {
		throw new TypeError(`Item movement ${type} has an invalid quantity direction.`);
	}
}
function validateReference(value: string | null | undefined, max: number, label: string): void {
	if (value != null && (value.length < 1 || value.length > max))
		throw new TypeError(`${label} must be 1-${max} characters when provided.`);
}
function isSingleEmoji(value: string): boolean {
	if (!value || value.length > 32) return false;
	const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)];
	return (
		segments.length === 1 &&
		/(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3)/u.test(value)
	);
}
function toIso(value: unknown): string {
	return new Date(value as string | number | Date).toISOString();
}
