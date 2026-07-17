import { getDB } from '$lib/server/db';
import { centsToMoney, moneyToCents } from '$lib/server/economy/money';
import { nextMonthlyBurnAt } from './guild-settings';

export interface MonthlyBurnResult {
	guildId: string;
	period: string;
	totalAmount: string;
	accountsAffected: number;
}

function money(value: unknown) {
	const [integer, fraction = ''] = String(value).split('.');
	return `${integer}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

function koreanPeriod(timestamp: number) {
	const date = new Date(timestamp + 9 * 60 * 60 * 1000);
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function calculateMonthlyBurn(balance: string, basisPoints: number): string {
	if (!Number.isInteger(basisPoints) || basisPoints < 1 || basisPoints > 10_000)
		throw new RangeError('Monthly burn basis points must be between 1 and 10000.');
	return centsToMoney((moneyToCents(balance) * BigInt(basisPoints)) / 10_000n);
}

export async function initializeMonthlyBurnSchedules(now = Date.now()) {
	const db = await getDB();
	await db`
		INSERT IGNORE INTO guild_settings (guild_id)
		SELECT DISTINCT guild_id FROM accounts
	`;
	const rows = await db`
		SELECT guild_id, monthly_burn_day, monthly_burn_hour, monthly_burn_minute
		FROM guild_settings
		WHERE monthly_burn_enabled=TRUE AND monthly_burn_next_at IS NULL
	`;
	for (const row of rows) {
		const nextAt = nextMonthlyBurnAt(
			{
				day: Number(row.monthly_burn_day),
				hour: Number(row.monthly_burn_hour),
				minute: Number(row.monthly_burn_minute)
			},
			new Date(now)
		);
		await db`
			UPDATE guild_settings SET monthly_burn_next_at=${nextAt}
			WHERE guild_id=${String(row.guild_id)} AND monthly_burn_next_at IS NULL
		`;
	}
}

export async function runDueMonthlyBurns(now = Date.now()): Promise<MonthlyBurnResult[]> {
	await initializeMonthlyBurnSchedules(now);
	const db = await getDB();
	const due = await db`
		SELECT guild_id FROM guild_settings
		WHERE monthly_burn_enabled=TRUE AND monthly_burn_next_at <= ${now}
		ORDER BY guild_id
	`;
	const results: MonthlyBurnResult[] = [];
	for (const row of due) {
		const guildId = String(row.guild_id);
		const result = await db.begin(async (tx) => {
			const settings = await tx`
				SELECT monthly_burn_enabled, monthly_burn_basis_points, monthly_burn_day,
					monthly_burn_hour, monthly_burn_minute, monthly_burn_next_at
				FROM guild_settings WHERE guild_id=${guildId} FOR UPDATE
			`;
			if (
				settings.length !== 1 ||
				!Boolean(settings[0].monthly_burn_enabled) ||
				Number(settings[0].monthly_burn_next_at) > now
			)
				return null;
			const scheduledAt = Number(settings[0].monthly_burn_next_at);
			const schedule = {
				day: Number(settings[0].monthly_burn_day),
				hour: Number(settings[0].monthly_burn_hour),
				minute: Number(settings[0].monthly_burn_minute)
			};
			const period = koreanPeriod(scheduledAt);
			const existingRun = await tx`
				SELECT guild_id FROM monthly_burn_runs
				WHERE guild_id=${guildId} AND burn_period=${period} LIMIT 1
			`;
			if (existingRun.length) {
				const nextAt = nextMonthlyBurnAt(schedule, new Date(Math.max(now, scheduledAt) + 1));
				await tx`
					UPDATE guild_settings SET monthly_burn_next_at=${nextAt} WHERE guild_id=${guildId}
				`;
				return null;
			}
			const accounts = await tx`
				SELECT user_id, balance FROM accounts
				WHERE guild_id=${guildId} AND balance >= 0.01
				ORDER BY user_id FOR UPDATE
			`;
			const basisPoints = Number(settings[0].monthly_burn_basis_points);
			let total = 0n;
			let affected = 0;
			for (const account of accounts) {
				const amountText = calculateMonthlyBurn(money(account.balance), basisPoints);
				const amount = moneyToCents(amountText);
				if (amount < 1n) continue;
				await tx`
					UPDATE accounts SET balance=balance-${amountText}
					WHERE guild_id=${guildId} AND user_id=${String(account.user_id)}
				`;
				await tx`
					INSERT INTO transactions
						(guild_id, sender_id, recipient_id, amount, transaction_type)
					VALUES (${guildId}, ${String(account.user_id)}, ${null}, ${amountText}, 'monthly_burn')
				`;
				total += amount;
				affected += 1;
			}
			await tx`
				INSERT INTO monthly_burn_runs
					(guild_id, burn_period, total_amount, accounts_affected)
				VALUES (${guildId}, ${period}, ${centsToMoney(total)}, ${affected})
			`;
			const nextAt = nextMonthlyBurnAt(schedule, new Date(Math.max(now, scheduledAt) + 1));
			await tx`
				UPDATE guild_settings SET monthly_burn_next_at=${nextAt} WHERE guild_id=${guildId}
			`;
			return { guildId, period, totalAmount: centsToMoney(total), accountsAffected: affected };
		});
		if (result) results.push(result);
	}
	return results;
}
