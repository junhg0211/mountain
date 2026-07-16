import { getDB } from '$lib/server/db';

export class AttendanceAlreadyClaimedError extends Error {}
export class AttendanceDisabledError extends Error {}

function formatMoney(value: unknown): string {
	const [integer, fraction = ''] = String(value).split('.');
	return `${integer}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

function normalizeDate(value: unknown): string {
	const text = String(value);
	if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
	return new Date(value as string | number | Date).toISOString().slice(0, 10);
}

export function getKoreanAttendanceDate(now = new Date()): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Asia/Seoul',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(now);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((entry) => entry.type === type)?.value || '';
	return `${part('year')}-${part('month')}-${part('day')}`;
}

function shiftDate(date: string, days: number): string {
	const value = new Date(`${date}T00:00:00Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return value.toISOString().slice(0, 10);
}

function calculateStreaks(dates: string[]) {
	const ordered = [...new Set(dates)].sort();
	let current = 0;
	let longest = 0;
	let previous = '';
	for (const date of ordered) {
		current = previous && shiftDate(previous, 1) === date ? current + 1 : 1;
		longest = Math.max(longest, current);
		previous = date;
	}
	return { current, longest };
}

async function backfillMissingStreaks(guildId: string, onlyUserId?: string) {
	const db = await getDB();
	const users = onlyUserId
		? await db`
			SELECT DISTINCT attendance_claims.user_id
			FROM attendance_claims
			LEFT JOIN attendance_streaks
				ON attendance_streaks.guild_id=attendance_claims.guild_id
				AND attendance_streaks.user_id=attendance_claims.user_id
			WHERE attendance_claims.guild_id=${guildId}
				AND attendance_claims.user_id=${onlyUserId}
				AND attendance_streaks.user_id IS NULL
		`
		: await db`
			SELECT DISTINCT attendance_claims.user_id
			FROM attendance_claims
			LEFT JOIN attendance_streaks
				ON attendance_streaks.guild_id=attendance_claims.guild_id
				AND attendance_streaks.user_id=attendance_claims.user_id
			WHERE attendance_claims.guild_id=${guildId} AND attendance_streaks.user_id IS NULL
		`;
	for (const user of users as Record<string, unknown>[]) {
		const userId = String(user.user_id);
		const history = await db`
			SELECT DATE_FORMAT(attendance_date, '%Y-%m-%d') AS date
			FROM attendance_claims
			WHERE guild_id=${guildId} AND user_id=${userId}
			ORDER BY attendance_date
		`;
		const dates = history.map((row: Record<string, unknown>) => String(row.date));
		const calculated = calculateStreaks(dates);
		const lastDate = dates.at(-1);
		if (!lastDate) continue;
		await db`
			INSERT IGNORE INTO attendance_streaks
				(guild_id, user_id, current_streak, longest_streak, last_attendance_date)
			VALUES (${guildId}, ${userId}, ${calculated.current}, ${calculated.longest}, ${lastDate})
		`;
	}
}

export async function getAttendanceStatus(guildId: string, userId: string) {
	const db = await getDB();
	await backfillMissingStreaks(guildId, userId);
	const date = getKoreanAttendanceDate();
	const rows = await db`
		SELECT COALESCE(guild_settings.attendance_reward, 0.00) AS reward,
			EXISTS(
				SELECT 1 FROM attendance_claims
				WHERE guild_id=${guildId} AND user_id=${userId} AND attendance_date=${date}
			) AS claimed,
			CASE
				WHEN attendance_streaks.last_attendance_date >= ${shiftDate(date, -1)}
				THEN COALESCE(attendance_streaks.current_streak, 0)
				ELSE 0
			END AS current_streak,
			COALESCE(attendance_streaks.longest_streak, 0) AS longest_streak
		FROM (SELECT ${guildId} AS guild_id) selected
		LEFT JOIN guild_settings ON guild_settings.guild_id=selected.guild_id
		LEFT JOIN attendance_streaks
			ON attendance_streaks.guild_id=selected.guild_id AND attendance_streaks.user_id=${userId}
	`;
	return {
		date,
		reward: formatMoney(rows[0]?.reward || 0),
		claimed: Boolean(rows[0]?.claimed),
		currentStreak: Number(rows[0]?.current_streak || 0),
		longestStreak: Number(rows[0]?.longest_streak || 0)
	};
}

export async function getAttendanceLeaderboard(guildId: string, limit = 10) {
	const db = await getDB();
	await backfillMissingStreaks(guildId);
	const yesterday = shiftDate(getKoreanAttendanceDate(), -1);
	const rows = await db`
		SELECT attendance_streaks.user_id, users.username,
			CASE WHEN attendance_streaks.last_attendance_date >= ${yesterday}
				THEN attendance_streaks.current_streak ELSE 0 END AS current_streak,
			attendance_streaks.longest_streak,
			DATE_FORMAT(attendance_streaks.last_attendance_date, '%Y-%m-%d') AS last_attendance_date
		FROM attendance_streaks
		LEFT JOIN users ON users.id=attendance_streaks.user_id
		WHERE attendance_streaks.guild_id=${guildId}
		ORDER BY attendance_streaks.longest_streak DESC,
			current_streak DESC, attendance_streaks.updated_at ASC
		LIMIT ${limit}
	`;
	return rows.map((row: Record<string, unknown>, index: number) => ({
		rank: index + 1,
		userId: String(row.user_id),
		username: String(row.username || '알 수 없는 사용자'),
		currentStreak: Number(row.current_streak),
		longestStreak: Number(row.longest_streak),
		lastAttendanceDate: normalizeDate(row.last_attendance_date)
	}));
}

export async function claimAttendance(guildId: string, userId: string) {
	const db = await getDB();
	const date = getKoreanAttendanceDate();
	return db.begin(async (tx) => {
		const settings = await tx`
			SELECT attendance_reward FROM guild_settings WHERE guild_id=${guildId} LIMIT 1
		`;
		const reward = formatMoney(settings[0]?.attendance_reward || 0);
		if (reward === '0.00') throw new AttendanceDisabledError();

		const claim = await tx`
			INSERT IGNORE INTO attendance_claims
				(guild_id, user_id, attendance_date, reward_amount)
			VALUES (${guildId}, ${userId}, ${date}, ${reward})
		`;
		if (Number(claim.affectedRows) !== 1) throw new AttendanceAlreadyClaimedError();

		const streakRows = await tx`
			SELECT current_streak, longest_streak,
				DATE_FORMAT(last_attendance_date, '%Y-%m-%d') AS last_attendance_date
			FROM attendance_streaks
			WHERE guild_id=${guildId} AND user_id=${userId} FOR UPDATE
		`;
		let currentStreak: number;
		let longestStreak: number;
		if (streakRows.length) {
			const lastDate = normalizeDate(streakRows[0].last_attendance_date);
			currentStreak =
				lastDate === shiftDate(date, -1) ? Number(streakRows[0].current_streak) + 1 : 1;
			longestStreak = Math.max(Number(streakRows[0].longest_streak), currentStreak);
		} else {
			const history = await tx`
				SELECT DATE_FORMAT(attendance_date, '%Y-%m-%d') AS date
				FROM attendance_claims
				WHERE guild_id=${guildId} AND user_id=${userId}
				ORDER BY attendance_date
			`;
			const calculated = calculateStreaks(
				history.map((row: Record<string, unknown>) => String(row.date))
			);
			currentStreak = calculated.current;
			longestStreak = calculated.longest;
		}
		await tx`
			INSERT INTO attendance_streaks
				(guild_id, user_id, current_streak, longest_streak, last_attendance_date)
			VALUES (${guildId}, ${userId}, ${currentStreak}, ${longestStreak}, ${date})
			ON DUPLICATE KEY UPDATE
				current_streak=VALUES(current_streak), longest_streak=VALUES(longest_streak),
				last_attendance_date=VALUES(last_attendance_date)
		`;

		await tx`INSERT IGNORE INTO accounts (guild_id, user_id) VALUES (${guildId}, ${userId})`;
		await tx`
			SELECT balance FROM accounts WHERE guild_id=${guildId} AND user_id=${userId} FOR UPDATE
		`;
		await tx`
			UPDATE accounts SET balance=balance+${reward}
			WHERE guild_id=${guildId} AND user_id=${userId}
		`;
		await tx`
			INSERT INTO transactions (guild_id, sender_id, recipient_id, amount, transaction_type)
			VALUES (${guildId}, ${null}, ${userId}, ${reward}, 'attendance')
		`;
		const balances = await tx`
			SELECT balance FROM accounts WHERE guild_id=${guildId} AND user_id=${userId} LIMIT 1
		`;
		return {
			date,
			reward,
			balance: formatMoney(balances[0].balance),
			currentStreak,
			longestStreak
		};
	});
}
