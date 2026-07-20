import { getDB } from '$lib/server/db';

const USERS_PER_MESSAGE = 40;

export interface AttendanceReminderBatch {
	guildId: string;
	reminderDate: string;
	chunkIndex: number;
	userIds: string[];
}

function koreanDateAndHour(now: Date) {
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

function previousDate(date: string) {
	const value = new Date(`${date}T00:00:00Z`);
	value.setUTCDate(value.getUTCDate() - 1);
	return value.toISOString().slice(0, 10);
}

export async function getAttendanceReminderBatches(now = new Date()) {
	const current = koreanDateAndHour(now);
	if (current.hour !== 0) return [];
	const db = await getDB();
	const yesterday = previousDate(current.date);
	const rows = await db`
		SELECT guild_settings.guild_id, attendance_claims.user_id
		FROM guild_settings
		JOIN attendance_claims
			ON attendance_claims.guild_id=guild_settings.guild_id
			AND attendance_claims.attendance_date=${yesterday}
		WHERE guild_settings.attendance_reward >= 0.01
			AND guild_settings.notification_channel_id IS NOT NULL
		ORDER BY guild_settings.guild_id, attendance_claims.user_id
	`;
	const usersByGuild = new Map<string, string[]>();
	for (const row of rows as Record<string, unknown>[]) {
		const guildId = String(row.guild_id);
		const users = usersByGuild.get(guildId) || [];
		users.push(String(row.user_id));
		usersByGuild.set(guildId, users);
	}
	const batches: AttendanceReminderBatch[] = [];
	for (const [guildId, userIds] of usersByGuild) {
		for (let offset = 0; offset < userIds.length; offset += USERS_PER_MESSAGE) {
			batches.push({
				guildId,
				reminderDate: current.date,
				chunkIndex: offset / USERS_PER_MESSAGE,
				userIds: userIds.slice(offset, offset + USERS_PER_MESSAGE)
			});
		}
	}
	return batches;
}

export async function reserveAttendanceReminder(batch: AttendanceReminderBatch) {
	const db = await getDB();
	const reservationId = crypto.randomUUID();
	await db`
		INSERT INTO attendance_reminder_runs
			(guild_id, reminder_date, chunk_index, reservation_id, reserved_at)
		VALUES (${batch.guildId}, ${batch.reminderDate}, ${batch.chunkIndex}, ${reservationId}, CURRENT_TIMESTAMP)
		ON DUPLICATE KEY UPDATE
			reservation_id=IF(
				sent_at IS NULL AND reserved_at <= CURRENT_TIMESTAMP - INTERVAL 5 MINUTE,
				VALUES(reservation_id), reservation_id
			),
			reserved_at=IF(reservation_id=VALUES(reservation_id), VALUES(reserved_at), reserved_at)
	`;
	const rows = await db`
		SELECT reservation_id, sent_at FROM attendance_reminder_runs
		WHERE guild_id=${batch.guildId} AND reminder_date=${batch.reminderDate}
			AND chunk_index=${batch.chunkIndex}
	`;
	return rows[0]?.sent_at == null && String(rows[0]?.reservation_id) === reservationId
		? reservationId
		: null;
}

export async function completeAttendanceReminder(batch: AttendanceReminderBatch, reservationId: string) {
	const db = await getDB();
	await db`
		UPDATE attendance_reminder_runs SET sent_at=CURRENT_TIMESTAMP
		WHERE guild_id=${batch.guildId} AND reminder_date=${batch.reminderDate}
			AND chunk_index=${batch.chunkIndex} AND reservation_id=${reservationId} AND sent_at IS NULL
	`;
}

export async function releaseAttendanceReminder(batch: AttendanceReminderBatch, reservationId: string) {
	const db = await getDB();
	await db`
		DELETE FROM attendance_reminder_runs
		WHERE guild_id=${batch.guildId} AND reminder_date=${batch.reminderDate}
			AND chunk_index=${batch.chunkIndex} AND reservation_id=${reservationId} AND sent_at IS NULL
	`;
}
