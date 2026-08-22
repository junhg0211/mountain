import { getDB } from '$lib/server/db';

export const MEMORY_OFFSETS = [
	{ label: '1년 전 오늘', months: 12 },
	{ label: '여섯 달 전 오늘', months: 6 },
	{ label: '네 달 전 오늘', months: 4 },
	{ label: '세 달 전 오늘', months: 3 },
	{ label: '두 달 전 오늘', months: 2 },
	{ label: '한 달 전 오늘', months: 1 },
	{ label: '일주일 전 오늘', days: 7 }
] as const;

export interface DailyMemory {
	label: string;
	date: string;
	content: string;
	username: string;
}

export interface ServerMemoryEntry {
	date: string;
	content: string;
	username: string;
	userId: string;
	updatedAt: string;
}

export function koreanDate(now = new Date()) {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Asia/Seoul',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(now);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((entry) => entry.type === type)?.value || '';
	return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
}

export function shiftDate(date: string, offset: { months?: number; days?: number }) {
	const [year, month, day] = date.split('-').map(Number);
	if (offset.days) {
		const result = new Date(Date.UTC(year, month - 1, day - offset.days));
		return result.toISOString().slice(0, 10);
	}
	const totalMonths = year * 12 + month - 1 - (offset.months || 0);
	const targetYear = Math.floor(totalMonths / 12);
	const targetMonth = totalMonths % 12;
	const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
	return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export function yesterday(date: string) {
	return shiftDate(date, { days: 1 });
}

export function isValidMemoryDate(date: string, latestDate: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > latestDate) return false;
	const parsed = new Date(`${date}T00:00:00Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export async function saveDailyMemory(input: {
	guildId: string;
	userId: string;
	username: string;
	entryDate: string;
	content: string;
}) {
	const db = await getDB();
	return db.begin(async (tx) => {
		await tx`
			INSERT INTO users (id, username) VALUES (${input.userId}, ${input.username})
			ON DUPLICATE KEY UPDATE username=VALUES(username)
		`;
		const inserted = await tx`
			INSERT IGNORE INTO daily_memories (guild_id, user_id, memory_date, content)
			VALUES (${input.guildId}, ${input.userId}, ${input.entryDate}, ${input.content})
		`;
		if (Number(inserted.count) !== 1) {
			await tx`
				UPDATE daily_memories SET content=${input.content}, updated_at=CURRENT_TIMESTAMP
				WHERE guild_id=${input.guildId} AND user_id=${input.userId}
					AND memory_date=${input.entryDate}
			`;
			return '0.00';
		}
		const settings = await tx`
			SELECT daily_memory_reward FROM guild_settings WHERE guild_id=${input.guildId} LIMIT 1
		`;
		const reward = Number(settings[0]?.daily_memory_reward || 0).toFixed(2);
		if (reward === '0.00') return reward;
		await tx`INSERT IGNORE INTO accounts (guild_id, user_id) VALUES (${input.guildId}, ${input.userId})`;
		await tx`
			SELECT balance FROM accounts
			WHERE guild_id=${input.guildId} AND user_id=${input.userId} FOR UPDATE
		`;
		await tx`
			UPDATE accounts SET balance=balance+${reward}
			WHERE guild_id=${input.guildId} AND user_id=${input.userId}
		`;
		await tx`
			INSERT INTO transactions (guild_id, sender_id, recipient_id, amount, transaction_type)
			VALUES (${input.guildId}, ${null}, ${input.userId}, ${reward}, 'daily_memory')
		`;
		return reward;
	});
}

export async function getRelatedMemories(guildId: string, baseDate: string) {
	const targets = MEMORY_OFFSETS.map((offset) => ({
		label: offset.label,
		date: shiftDate(baseDate, offset)
	}));
	const db = await getDB();
	const rows = await db`
		SELECT DATE_FORMAT(daily_memories.memory_date, '%Y-%m-%d') AS memory_date,
			daily_memories.content, users.username
		FROM daily_memories
		JOIN users ON users.id=daily_memories.user_id
		WHERE daily_memories.guild_id=${guildId}
			AND daily_memories.memory_date IN (
				${targets[0].date}, ${targets[1].date}, ${targets[2].date}, ${targets[3].date},
				${targets[4].date}, ${targets[5].date}, ${targets[6].date}
			)
		ORDER BY daily_memories.memory_date DESC, daily_memories.created_at
	`;
	const labels = new Map(targets.map((target) => [target.date, target.label]));
	return (rows as Record<string, unknown>[]).map(
		(row): DailyMemory => ({
			date: String(row.memory_date),
			label: labels.get(String(row.memory_date))!,
			content: String(row.content),
			username: String(row.username)
		})
	);
}

export async function getRecentDailyMemories(guildId: string, limit = 30) {
	const db = await getDB();
	const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
	const rows = await db`
		SELECT DATE_FORMAT(daily_memories.memory_date, '%Y-%m-%d') AS memory_date,
			daily_memories.content, daily_memories.user_id, daily_memories.updated_at,
			users.username
		FROM daily_memories
		JOIN users ON users.id=daily_memories.user_id
		WHERE daily_memories.guild_id=${guildId}
		ORDER BY daily_memories.memory_date DESC, daily_memories.updated_at DESC
		LIMIT ${safeLimit}
	`;
	return (rows as Record<string, unknown>[]).map(
		(row): ServerMemoryEntry => ({
			date: String(row.memory_date),
			content: String(row.content),
			username: String(row.username),
			userId: String(row.user_id),
			updatedAt: new Date(row.updated_at as string | number | Date).toISOString()
		})
	);
}

export interface DailyMemoryPrompt {
	guildId: string;
	promptDate: string;
	entryDate: string;
	channelId: string;
}

export async function getDailyMemoryPrompts(now = new Date()) {
	const current = koreanDate(now);
	if (current.hour !== 0) return [];
	const db = await getDB();
	const rows = await db`
		SELECT guild_id, notification_channel_id
		FROM guild_settings
		WHERE notification_channel_id IS NOT NULL
	`;
	return (rows as Record<string, unknown>[]).map(
		(row): DailyMemoryPrompt => ({
			guildId: String(row.guild_id),
			promptDate: current.date,
			entryDate: yesterday(current.date),
			channelId: String(row.notification_channel_id)
		})
	);
}

export async function reserveDailyMemoryPrompt(prompt: DailyMemoryPrompt) {
	const db = await getDB();
	const result = await db`
		INSERT IGNORE INTO daily_memory_prompt_runs (guild_id, prompt_date)
		VALUES (${prompt.guildId}, ${prompt.promptDate})
	`;
	return Number(result.count) === 1;
}

export async function releaseDailyMemoryPrompt(prompt: DailyMemoryPrompt) {
	const db = await getDB();
	await db`
		DELETE FROM daily_memory_prompt_runs
		WHERE guild_id=${prompt.guildId} AND prompt_date=${prompt.promptDate} AND sent_at IS NULL
	`;
}

export async function completeDailyMemoryPrompt(prompt: DailyMemoryPrompt) {
	const db = await getDB();
	await db`
		UPDATE daily_memory_prompt_runs SET sent_at=CURRENT_TIMESTAMP
		WHERE guild_id=${prompt.guildId} AND prompt_date=${prompt.promptDate}
	`;
}
