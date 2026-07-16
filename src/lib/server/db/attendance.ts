import { getDB } from '$lib/server/db';

export class AttendanceAlreadyClaimedError extends Error {}
export class AttendanceDisabledError extends Error {}

function formatMoney(value: unknown): string {
	const [integer, fraction = ''] = String(value).split('.');
	return `${integer}.${fraction.padEnd(2, '0').slice(0, 2)}`;
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

export async function getAttendanceStatus(guildId: string, userId: string) {
	const db = await getDB();
	const date = getKoreanAttendanceDate();
	const rows = await db`
		SELECT COALESCE(guild_settings.attendance_reward, 0.00) AS reward,
			EXISTS(
				SELECT 1 FROM attendance_claims
				WHERE guild_id=${guildId} AND user_id=${userId} AND attendance_date=${date}
			) AS claimed
		FROM (SELECT ${guildId} AS guild_id) selected
		LEFT JOIN guild_settings ON guild_settings.guild_id=selected.guild_id
	`;
	return {
		date,
		reward: formatMoney(rows[0]?.reward || 0),
		claimed: Boolean(rows[0]?.claimed)
	};
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
		return { date, reward, balance: formatMoney(balances[0].balance) };
	});
}
