import { getDB } from '$lib/server/db';

export const DEFAULT_CURRENCY_UNIT = 'coin';

export async function setCurrencyUnit(guildId: string, unit: string): Promise<void> {
	const db = getDB();
	await db`
		INSERT INTO guild_settings (guild_id, currency_unit)
		VALUES (${guildId}, ${unit})
		ON DUPLICATE KEY UPDATE currency_unit = VALUES(currency_unit)
	`;
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
