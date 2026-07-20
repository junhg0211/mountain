import {
	completeAttendanceReminder,
	getAttendanceReminderBatches,
	releaseAttendanceReminder,
	reserveAttendanceReminder
} from '$lib/server/db/attendance-reminders';
import { sendUserMentionNotification } from './notifications';

const SCAN_INTERVAL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function scan() {
	if (running || !process.env.BOT_TOKEN) return;
	running = true;
	try {
		for (const batch of await getAttendanceReminderBatches()) {
			const reservationId = await reserveAttendanceReminder(batch);
			if (!reservationId) continue;
			const mentions = batch.userIds.map((userId) => `<@${userId}>`).join(' ');
			const sent = await sendUserMentionNotification(
				batch.guildId,
				`📅 ${mentions} 어제 출석하셨네요! 오늘도 출석하고 연속 출석을 이어가세요.`,
				batch.userIds
			);
			if (sent) await completeAttendanceReminder(batch, reservationId);
			else await releaseAttendanceReminder(batch, reservationId);
		}
	} catch (error) {
		console.error('Attendance reminder scan failed:', error);
	} finally {
		running = false;
	}
}

export function startAttendanceReminderScheduler() {
	if (timer) return;
	void scan();
	timer = setInterval(() => void scan(), SCAN_INTERVAL_MS);
	timer.unref();
}

export function stopAttendanceReminderScheduler() {
	if (timer) clearInterval(timer);
	timer = null;
}
