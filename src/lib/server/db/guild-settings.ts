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
