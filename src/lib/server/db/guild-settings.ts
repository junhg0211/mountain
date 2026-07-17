import { getDB } from '$lib/server/db';

export const DEFAULT_CURRENCY_UNIT = 'coin';

export interface EconomyVisibilitySettings {
	publicBalanceEnabled: boolean;
	rankingEnabled: boolean;
}

export async function setCurrencyUnit(guildId: string, unit: string): Promise<void> {
	const db = await getDB();
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
	const db = await getDB();
	await db`
		INSERT INTO guild_settings (guild_id, public_balance_enabled, ranking_enabled)
		VALUES (${guildId}, ${settings.publicBalanceEnabled}, ${settings.rankingEnabled})
		ON DUPLICATE KEY UPDATE
			public_balance_enabled = VALUES(public_balance_enabled),
			ranking_enabled = VALUES(ranking_enabled)
	`;
}

export async function getVisibilitySettings(guildId: string): Promise<EconomyVisibilitySettings> {
	const db = await getDB();
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
	const db = await getDB();
	const rows = await db`
		SELECT currency_unit
		FROM guild_settings
		WHERE guild_id = ${guildId}
		LIMIT 1
	`;

	return rows.length === 1 ? String(rows[0].currency_unit) : DEFAULT_CURRENCY_UNIT;
}

export async function setAttendanceReward(guildId: string, amount: string): Promise<void> {
	const db = await getDB();
	await db`
		INSERT INTO guild_settings (guild_id, attendance_reward)
		VALUES (${guildId}, ${amount})
		ON DUPLICATE KEY UPDATE attendance_reward=VALUES(attendance_reward)
	`;
}

export interface VoiceActivitySettings {
	reward: string;
	dailyCap: string;
}

export interface MonthlyBurnSettings {
	enabled: boolean;
	basisPoints: number;
	day: number;
	hour: number;
	minute: number;
}

export function nextMonthlyBurnAt(
	settings: Pick<MonthlyBurnSettings, 'day' | 'hour' | 'minute'>,
	now = new Date()
): number {
	const koreanNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
	let year = koreanNow.getUTCFullYear();
	let month = koreanNow.getUTCMonth();
	let candidate = Date.UTC(year, month, settings.day, settings.hour - 9, settings.minute);
	if (candidate <= now.getTime()) {
		month += 1;
		if (month > 11) {
			month = 0;
			year += 1;
		}
		candidate = Date.UTC(year, month, settings.day, settings.hour - 9, settings.minute);
	}
	return candidate;
}

export async function setMonthlyBurnSettings(guildId: string, settings: MonthlyBurnSettings) {
	const db = await getDB();
	const nextAt = settings.enabled ? nextMonthlyBurnAt(settings) : null;
	await db`
		INSERT INTO guild_settings (
			guild_id, monthly_burn_enabled, monthly_burn_basis_points,
			monthly_burn_day, monthly_burn_hour, monthly_burn_minute, monthly_burn_next_at
		) VALUES (
			${guildId}, ${settings.enabled}, ${settings.basisPoints},
			${settings.day}, ${settings.hour}, ${settings.minute}, ${nextAt}
		)
		ON DUPLICATE KEY UPDATE
			monthly_burn_enabled=VALUES(monthly_burn_enabled),
			monthly_burn_basis_points=VALUES(monthly_burn_basis_points),
			monthly_burn_day=VALUES(monthly_burn_day),
			monthly_burn_hour=VALUES(monthly_burn_hour),
			monthly_burn_minute=VALUES(monthly_burn_minute),
			monthly_burn_next_at=VALUES(monthly_burn_next_at)
	`;
}

export async function setVoiceActivitySettings(
	guildId: string,
	settings: VoiceActivitySettings
): Promise<void> {
	const db = await getDB();
	await db`
		INSERT INTO guild_settings (guild_id, voice_activity_reward, voice_activity_daily_cap)
		VALUES (${guildId}, ${settings.reward}, ${settings.dailyCap})
		ON DUPLICATE KEY UPDATE
			voice_activity_reward=VALUES(voice_activity_reward),
			voice_activity_daily_cap=VALUES(voice_activity_daily_cap)
	`;
}

export async function getVoiceActivitySettings(guildId: string): Promise<VoiceActivitySettings> {
	const db = await getDB();
	const rows = await db`
		SELECT voice_activity_reward, voice_activity_daily_cap
		FROM guild_settings WHERE guild_id=${guildId} LIMIT 1
	`;
	return {
		reward: Number(rows[0]?.voice_activity_reward || 0).toFixed(2),
		dailyCap: Number(rows[0]?.voice_activity_daily_cap || 0).toFixed(2)
	};
}

export async function setNotificationChannel(guildId: string, channelId: string | null) {
	const db = await getDB();
	await db`
		INSERT INTO guild_settings (guild_id, notification_channel_id)
		VALUES (${guildId}, ${channelId})
		ON DUPLICATE KEY UPDATE notification_channel_id = VALUES(notification_channel_id)
	`;
}

export async function getNotificationChannel(guildId: string): Promise<string | null> {
	const db = await getDB();
	const rows =
		await db`SELECT notification_channel_id FROM guild_settings WHERE guild_id=${guildId} LIMIT 1`;
	return rows[0]?.notification_channel_id ? String(rows[0].notification_channel_id) : null;
}
