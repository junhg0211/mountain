const KST_OFFSET = 9 * 60 * 60 * 1000;

export type PaymentSchedule =
	| { type: 'interval'; intervalDays: number; hour: number; minute: number }
	| { type: 'weekly'; weekday: number; hour: number; minute: number }
	| { type: 'monthly'; monthDay: number; hour: number; minute: number };

function kstParts(epoch: number) {
	const date = new Date(epoch + KST_OFFSET);
	return {
		year: date.getUTCFullYear(),
		month: date.getUTCMonth(),
		day: date.getUTCDate(),
		weekday: date.getUTCDay()
	};
}

function kstEpoch(year: number, month: number, day: number, hour: number, minute: number) {
	return Date.UTC(year, month, day, hour, minute) - KST_OFFSET;
}

export function firstScheduleAt(schedule: PaymentSchedule, now = Date.now()): number {
	const current = kstParts(now);
	if (schedule.type === 'interval') {
		return kstEpoch(
			current.year,
			current.month,
			current.day + schedule.intervalDays,
			schedule.hour,
			schedule.minute
		);
	}
	if (schedule.type === 'weekly') {
		let days = (schedule.weekday - current.weekday + 7) % 7;
		let candidate = kstEpoch(
			current.year,
			current.month,
			current.day + days,
			schedule.hour,
			schedule.minute
		);
		if (candidate <= now) candidate += 7 * 86_400_000;
		return candidate;
	}
	let candidate = kstEpoch(
		current.year,
		current.month,
		schedule.monthDay,
		schedule.hour,
		schedule.minute
	);
	if (candidate <= now) candidate = kstEpoch(current.year, current.month + 1, schedule.monthDay, schedule.hour, schedule.minute);
	return candidate;
}

export function nextScheduleAt(schedule: PaymentSchedule, scheduledAt: number, now = Date.now()): number {
	let next = scheduledAt;
	do {
		if (schedule.type === 'interval') next += schedule.intervalDays * 86_400_000;
		else if (schedule.type === 'weekly') next += 7 * 86_400_000;
		else {
			const previous = kstParts(next);
			next = kstEpoch(previous.year, previous.month + 1, schedule.monthDay, schedule.hour, schedule.minute);
		}
	} while (next <= now);
	return next;
}

export function nextRoleChargeAt(now = Date.now()) {
	const current = kstParts(now);
	return kstEpoch(current.year, current.month + 1, 1, 12, 0);
}
