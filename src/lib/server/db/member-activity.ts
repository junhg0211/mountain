import { getDB } from '$lib/server/db';

const KOREAN_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Asia/Seoul',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

export function koreanActivityDate(now = new Date()) {
	return KOREAN_DATE_FORMAT.format(now);
}

export async function recordMessageActivity(guildId: string, userId: string, now = new Date()) {
	const db = await getDB();
	await db`
		INSERT INTO member_activity_daily (guild_id, user_id, activity_date, message_count)
		VALUES (${guildId}, ${userId}, ${koreanActivityDate(now)}, 1)
		ON DUPLICATE KEY UPDATE message_count=message_count+1
	`;
}

export async function recordVoiceActivity(
	guildId: string,
	userId: string,
	seconds: number,
	now = new Date()
) {
	if (!Number.isSafeInteger(seconds) || seconds <= 0)
		throw new TypeError('seconds must be positive');
	const db = await getDB();
	await db`
		INSERT INTO member_activity_daily (guild_id, user_id, activity_date, voice_seconds)
		VALUES (${guildId}, ${userId}, ${koreanActivityDate(now)}, ${seconds})
		ON DUPLICATE KEY UPDATE voice_seconds=voice_seconds+VALUES(voice_seconds)
	`;
}

export async function getMemberActivityRanking(
	guildId: string,
	startDate: string,
	endDate: string
) {
	const db = await getDB();
	const rows = await db`
		SELECT activity.user_id, users.username, users.avatar_url,
			SUM(activity.message_count) AS message_count,
			SUM(activity.voice_seconds) AS voice_seconds
		FROM member_activity_daily activity
		JOIN users ON users.id=activity.user_id
		WHERE activity.guild_id=${guildId}
			AND activity.activity_date BETWEEN ${startDate} AND ${endDate}
		GROUP BY activity.user_id, users.username, users.avatar_url
		ORDER BY (SUM(activity.message_count) + FLOOR(SUM(activity.voice_seconds) / 300)) DESC,
			SUM(activity.message_count) DESC, SUM(activity.voice_seconds) DESC, activity.user_id
		LIMIT 100
	`;
	return rows.map((row: Record<string, unknown>, index: number) => ({
		rank: index + 1,
		userId: String(row.user_id),
		username: String(row.username),
		avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
		messageCount: Number(row.message_count),
		voiceSeconds: Number(row.voice_seconds),
		participationScore: Number(row.message_count) + Math.floor(Number(row.voice_seconds) / 300)
	}));
}
