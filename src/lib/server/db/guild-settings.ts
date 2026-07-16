import { getDB } from '$lib/server/db';

export const DEFAULT_CURRENCY_UNIT = 'coin';

export interface EconomyVisibilitySettings {
	publicBalanceEnabled: boolean;
	rankingEnabled: boolean;
}

export async function setCurrencyUnit(guildId: string, unit: string): Promise<void> {
	const db = getDB();
	await db`
		INSERT INTO guild_settings (guild_id, currency_unit)
		VALUES (${guildId}, ${unit})
		ON DUPLICATE KEY UPDATE currency_unit = VALUES(currency_unit)
	`;
}

export async function setVisibilitySettings(
	guildId: string,
	settings: EconomyVisibilitySettings
): Promise<void> {
	const db = getDB();
	await db`
		INSERT INTO guild_settings (guild_id, public_balance_enabled, ranking_enabled)
		VALUES (${guildId}, ${settings.publicBalanceEnabled}, ${settings.rankingEnabled})
		ON DUPLICATE KEY UPDATE
			public_balance_enabled = VALUES(public_balance_enabled),
			ranking_enabled = VALUES(ranking_enabled)
	`;
}

export async function getVisibilitySettings(guildId: string): Promise<EconomyVisibilitySettings> {
	const db = getDB();
	const rows = await db`
		SELECT public_balance_enabled, ranking_enabled FROM guild_settings
		WHERE guild_id = ${guildId} LIMIT 1
	`;
	return {
		publicBalanceEnabled: rows.length === 0 || Boolean(rows[0].public_balance_enabled),
		rankingEnabled: rows.length === 0 || Boolean(rows[0].ranking_enabled)
	};
}

export async function getCurrencyUnit(guildId: string): Promise<string> {
	const db = getDB();
	const rows = await db`
		SELECT currency_unit
		FROM guild_settings
		WHERE guild_id = ${guildId}
		LIMIT 1
	`;

	return rows.length === 1 ? String(rows[0].currency_unit) : DEFAULT_CURRENCY_UNIT;
}

export async function setNotificationChannel(guildId: string, channelId: string | null) {
	const db = getDB();
	await db`
		INSERT INTO guild_settings (guild_id, notification_channel_id)
		VALUES (${guildId}, ${channelId})
		ON DUPLICATE KEY UPDATE notification_channel_id = VALUES(notification_channel_id)
	`;
}

export async function getNotificationChannel(guildId: string): Promise<string | null> {
	const db = getDB();
	const rows =
		await db`SELECT notification_channel_id FROM guild_settings WHERE guild_id=${guildId} LIMIT 1`;
	return rows[0]?.notification_channel_id ? String(rows[0].notification_channel_id) : null;
}
