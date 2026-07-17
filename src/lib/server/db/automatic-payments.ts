import { getDB } from '$lib/server/db';
import { centsToMoney, moneyToCents } from '$lib/server/economy/money';
import {
	firstScheduleAt,
	nextRoleChargeAt,
	nextScheduleAt,
	type PaymentSchedule
} from '$lib/server/economy/schedules';
import { InsufficientBalanceError } from './accounts';
import { addGuildMemberRole, getGuildMember, getGuildRoles, removeGuildMemberRole } from '$lib/server/discord/users';

function money(value: unknown) {
	return Number(value).toFixed(2);
}

export async function listRolePlans(guildId: string, includeInactive = false) {
	const db = await getDB();
	const rows = includeInactive
		? await db`SELECT * FROM role_subscription_plans WHERE guild_id=${guildId} ORDER BY active DESC, name`
		: await db`SELECT * FROM role_subscription_plans WHERE guild_id=${guildId} AND active=TRUE ORDER BY name`;
	return rows.map((row: Record<string, unknown>) => ({
		id: String(row.id), roleId: String(row.role_id), name: String(row.name),
		monthlyPrice: money(row.monthly_price), active: Boolean(row.active)
	}));
}

export async function saveRolePlan(guildId: string, roleId: string, name: string, monthlyPrice: string) {
	const db = await getDB();
	await db`INSERT INTO role_subscription_plans (guild_id, role_id, name, monthly_price, active)
		VALUES (${guildId}, ${roleId}, ${name}, ${monthlyPrice}, TRUE)
		ON DUPLICATE KEY UPDATE name=VALUES(name), monthly_price=VALUES(monthly_price), active=TRUE`;
}

export async function disableRolePlan(guildId: string, planId: string) {
	const db = await getDB();
	await db.begin(async (tx) => {
		await tx`UPDATE role_subscription_plans SET active=FALSE WHERE id=${planId} AND guild_id=${guildId}`;
		await tx`UPDATE role_subscriptions SET status='cancelled', next_charge_at=NULL,
			last_error='관리자가 구독 상품을 비활성화했습니다.' WHERE plan_id=${planId} AND guild_id=${guildId} AND status='active'`;
	});
}

export async function getUserAutomaticPayments(guildId: string, userId: string) {
	const db = await getDB();
	const [subscriptions, transfers, runs] = await Promise.all([
		db`SELECT rs.id, rs.status, rs.next_charge_at, rs.last_error, rp.name, rp.role_id, rp.monthly_price
			FROM role_subscriptions rs JOIN role_subscription_plans rp ON rp.id=rs.plan_id
			WHERE rs.guild_id=${guildId} AND rs.user_id=${userId} ORDER BY rs.created_at DESC`,
		db`SELECT st.*, u.username AS recipient_name FROM scheduled_transfers st
			JOIN users u ON u.id=st.recipient_id WHERE st.guild_id=${guildId} AND st.sender_id=${userId}
			ORDER BY st.created_at DESC`,
		db`SELECT payment_type, reference_id, amount, status, error_message, created_at
			FROM automatic_payment_runs apr WHERE apr.guild_id=${guildId} AND (
				(apr.payment_type='scheduled_transfer' AND EXISTS (SELECT 1 FROM scheduled_transfers st WHERE st.id=apr.reference_id AND st.guild_id=${guildId} AND st.sender_id=${userId}))
				OR (apr.payment_type='role_subscription' AND EXISTS (SELECT 1 FROM role_subscriptions rs WHERE rs.id=apr.reference_id AND rs.guild_id=${guildId} AND rs.user_id=${userId}))
			) ORDER BY created_at DESC LIMIT 30`
	]);
	return {
		subscriptions: subscriptions.map((r: Record<string, unknown>) => ({ id: String(r.id), name: String(r.name), roleId: String(r.role_id), monthlyPrice: money(r.monthly_price), status: String(r.status), nextChargeAt: r.next_charge_at ? Number(r.next_charge_at) : null, lastError: r.last_error ? String(r.last_error) : null })),
		transfers: transfers.map((r: Record<string, unknown>) => ({ id: String(r.id), recipientId: String(r.recipient_id), recipientName: String(r.recipient_name), amount: money(r.amount), scheduleType: String(r.schedule_type), intervalDays: r.interval_days ? Number(r.interval_days) : null, weekday: r.weekday === null ? null : Number(r.weekday), monthDay: r.month_day ? Number(r.month_day) : null, runHour: Number(r.run_hour), runMinute: Number(r.run_minute), nextRunAt: Number(r.next_run_at), status: String(r.status), lastError: r.last_error ? String(r.last_error) : null, totalTransferred: money(r.total_transferred) })),
		runs: runs.map((r: Record<string, unknown>) => ({ type: String(r.payment_type), referenceId: String(r.reference_id), amount: money(r.amount), status: String(r.status), error: r.error_message ? String(r.error_message) : null, createdAt: new Date(r.created_at as string).toISOString() }))
	};
}

export async function subscribeRole(guildId: string, userId: string, planId: string) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const plans = await tx`SELECT id, monthly_price FROM role_subscription_plans WHERE id=${planId} AND guild_id=${guildId} AND active=TRUE FOR UPDATE`;
		if (plans.length !== 1) throw new Error('ROLE_PLAN_NOT_FOUND');
		const active = await tx`SELECT id FROM role_subscriptions WHERE guild_id=${guildId} AND user_id=${userId} AND status='active' FOR UPDATE`;
		if (active.length) throw new Error('ACTIVE_ROLE_SUBSCRIPTION');
		await tx`INSERT IGNORE INTO accounts (guild_id,user_id) VALUES (${guildId},${userId})`;
		const accounts = await tx`SELECT balance FROM accounts WHERE guild_id=${guildId} AND user_id=${userId} FOR UPDATE`;
		const price = money(plans[0].monthly_price);
		if (moneyToCents(money(accounts[0].balance)) < moneyToCents(price)) throw new InsufficientBalanceError();
		await tx`UPDATE accounts SET balance=balance-${price} WHERE guild_id=${guildId} AND user_id=${userId}`;
		await tx`INSERT INTO transactions (guild_id,sender_id,recipient_id,amount,transaction_type) VALUES (${guildId},${userId},${null},${price},'role_subscription')`;
		await tx`INSERT INTO role_subscriptions (plan_id,guild_id,user_id,status,next_charge_at,last_error)
			VALUES (${planId},${guildId},${userId},'active',${nextRoleChargeAt()},NULL)
			ON DUPLICATE KEY UPDATE status='active',next_charge_at=VALUES(next_charge_at),last_error=NULL`;
		const ids = await tx`SELECT id FROM role_subscriptions WHERE plan_id=${planId} AND user_id=${userId}`;
		await tx`INSERT INTO automatic_payment_runs (payment_type,reference_id,run_key,guild_id,amount,status)
			VALUES ('role_subscription',${String(ids[0].id)},${`signup:${Date.now()}`},${guildId},${price},'success')`;
		return { subscriptionId: String(ids[0].id), price };
	});
}

export async function cancelRoleSubscription(guildId: string, userId: string, subscriptionId: string) {
	const db = await getDB();
	await db`UPDATE role_subscriptions SET status='cancelled',next_charge_at=NULL,last_error=NULL
		WHERE id=${subscriptionId} AND guild_id=${guildId} AND user_id=${userId}`;
}

export async function createScheduledTransfer(guildId: string, senderId: string, recipientId: string, amount: string, schedule: PaymentSchedule) {
	const db = await getDB();
	const intervalDays = schedule.type === 'interval' ? schedule.intervalDays : null;
	const weekday = schedule.type === 'weekly' ? schedule.weekday : null;
	const monthDay = schedule.type === 'monthly' ? schedule.monthDay : null;
	await db`INSERT INTO scheduled_transfers (guild_id,sender_id,recipient_id,amount,schedule_type,interval_days,weekday,month_day,run_hour,run_minute,next_run_at)
		VALUES (${guildId},${senderId},${recipientId},${amount},${schedule.type},${intervalDays},${weekday},${monthDay},${schedule.hour},${schedule.minute},${firstScheduleAt(schedule)})`;
}

export async function cancelScheduledTransfer(guildId: string, senderId: string, id: string) {
	const db = await getDB();
	await db`UPDATE scheduled_transfers SET status='cancelled' WHERE id=${id} AND guild_id=${guildId} AND sender_id=${senderId}`;
}

function scheduleFromRow(row: Record<string, unknown>): PaymentSchedule {
	const base = { hour: Number(row.run_hour), minute: Number(row.run_minute) };
	if (row.schedule_type === 'interval') return { type: 'interval', intervalDays: Number(row.interval_days), ...base };
	if (row.schedule_type === 'weekly') return { type: 'weekly', weekday: Number(row.weekday), ...base };
	return { type: 'monthly', monthDay: Number(row.month_day), ...base };
}

export async function processDueScheduledTransfers(now = Date.now()) {
	const db = await getDB();
	const completed: Array<{ guildId: string; senderId: string; recipientId: string; amount: string }> = [];
	const due = await db`SELECT id FROM scheduled_transfers WHERE status='active' AND next_run_at<=${now} ORDER BY next_run_at LIMIT 50`;
	for (const item of due) {
		const target = await db`SELECT guild_id,recipient_id FROM scheduled_transfers WHERE id=${String(item.id)} AND status='active'`;
		if (!target.length) continue;
		const member = await getGuildMember(String(target[0].guild_id), String(target[0].recipient_id)).catch(() => undefined);
		if (member === null) {
			await db`UPDATE scheduled_transfers SET status='cancelled',last_error='받는 사람이 서버를 나갔습니다.' WHERE id=${String(item.id)}`;
			continue;
		}
		const success = await db.begin(async (tx) => {
			const rows = await tx`SELECT * FROM scheduled_transfers WHERE id=${String(item.id)} FOR UPDATE`;
			if (!rows.length || rows[0].status !== 'active' || Number(rows[0].next_run_at) > now) return false;
			const row = rows[0] as Record<string, unknown>;
			const id = String(row.id), guildId = String(row.guild_id), senderId = String(row.sender_id), recipientId = String(row.recipient_id), amount = money(row.amount);
			const runKey = String(row.next_run_at);
			const next = nextScheduleAt(scheduleFromRow(row), Number(row.next_run_at), now);
			const duplicate = await tx`SELECT id FROM automatic_payment_runs WHERE payment_type='scheduled_transfer' AND reference_id=${id} AND run_key=${runKey}`;
			if (duplicate.length) { await tx`UPDATE scheduled_transfers SET next_run_at=${next} WHERE id=${id}`; return false; }
			await tx`INSERT IGNORE INTO accounts (guild_id,user_id) VALUES (${guildId},${senderId}),(${guildId},${recipientId})`;
			const accounts = await tx`SELECT user_id,balance FROM accounts WHERE guild_id=${guildId} AND user_id IN (${senderId},${recipientId}) ORDER BY user_id FOR UPDATE`;
			const sender = accounts.find((a: Record<string, unknown>) => String(a.user_id) === senderId);
			if (!sender || moneyToCents(money(sender.balance)) < moneyToCents(amount)) {
				await tx`INSERT INTO automatic_payment_runs (payment_type,reference_id,run_key,guild_id,amount,status,error_message) VALUES ('scheduled_transfer',${id},${runKey},${guildId},${amount},'failed','잔액 부족')`;
				await tx`UPDATE scheduled_transfers SET next_run_at=${next},last_error='잔액 부족' WHERE id=${id}`;
				return false;
			}
			await tx`UPDATE accounts SET balance=balance-${amount} WHERE guild_id=${guildId} AND user_id=${senderId}`;
			await tx`UPDATE accounts SET balance=balance+${amount} WHERE guild_id=${guildId} AND user_id=${recipientId}`;
			await tx`INSERT INTO transactions (guild_id,sender_id,recipient_id,amount,transaction_type) VALUES (${guildId},${senderId},${recipientId},${amount},'scheduled_transfer')`;
			await tx`INSERT INTO automatic_payment_runs (payment_type,reference_id,run_key,guild_id,amount,status) VALUES ('scheduled_transfer',${id},${runKey},${guildId},${amount},'success')`;
			await tx`UPDATE scheduled_transfers SET next_run_at=${next},last_error=NULL,total_transferred=total_transferred+${amount} WHERE id=${id}`;
			return true;
		});
		if (success) completed.push({ guildId: String(target[0].guild_id), senderId: String((await db`SELECT sender_id FROM scheduled_transfers WHERE id=${String(item.id)}`)[0].sender_id), recipientId: String(target[0].recipient_id), amount: money((await db`SELECT amount FROM scheduled_transfers WHERE id=${String(item.id)}`)[0].amount) });
	}
	return completed;
}

export async function processDueRoleSubscriptions(now = Date.now()) {
	const db = await getDB();
	const completed: Array<{ guildId: string; userId: string; amount: string }> = [];
	const due = await db`SELECT rs.id,rs.plan_id,rs.guild_id,rs.user_id,rp.role_id
		FROM role_subscriptions rs JOIN role_subscription_plans rp ON rp.id=rs.plan_id
		WHERE rs.status='active' AND rs.next_charge_at<=${now} ORDER BY rs.next_charge_at LIMIT 50`;
	for (const item of due) {
		const guildId = String(item.guild_id), userId = String(item.user_id), roleId = String(item.role_id), id = String(item.id), planId = String(item.plan_id);
		const [roles, member] = await Promise.all([
			getGuildRoles(guildId).catch(() => undefined), getGuildMember(guildId, userId).catch(() => undefined)
		]);
		if (roles && !roles.some((role) => role.id === roleId && !role.managed)) {
			await db.begin(async (tx) => {
				await tx`UPDATE role_subscription_plans SET active=FALSE WHERE id=${planId}`;
				await tx`UPDATE role_subscriptions SET status='cancelled',next_charge_at=NULL,last_error='Discord 역할이 삭제되었거나 관리할 수 없습니다.' WHERE plan_id=${planId} AND status='active'`;
			});
			continue;
		}
		if (member === null) {
			await db`UPDATE role_subscriptions SET status='cancelled',next_charge_at=NULL,last_error='서버 구성원을 찾을 수 없습니다.' WHERE id=${id}`;
			await removeGuildMemberRole(guildId, userId, roleId).catch(() => undefined);
			continue;
		}
		if (member && !member.roles?.includes(roleId)) {
			try { await addGuildMemberRole(guildId, userId, roleId); }
			catch (error) {
				if (error instanceof Error && /\((403|404)\)/.test(error.message)) {
					await db.begin(async (tx) => {
						await tx`UPDATE role_subscription_plans SET active=FALSE WHERE id=${planId}`;
						await tx`UPDATE role_subscriptions SET status='cancelled',next_charge_at=NULL,last_error='Discord 역할을 지급할 수 없습니다.' WHERE plan_id=${planId} AND status='active'`;
					});
				}
				continue;
			}
		}
		const success = await db.begin(async (tx) => {
			const rows = await tx`SELECT rs.*,rp.monthly_price,rp.active FROM role_subscriptions rs JOIN role_subscription_plans rp ON rp.id=rs.plan_id WHERE rs.id=${id} FOR UPDATE`;
			if (!rows.length || rows[0].status !== 'active' || Number(rows[0].next_charge_at) > now) return false;
			const row = rows[0] as Record<string, unknown>, amount = money(row.monthly_price), runKey = String(row.next_charge_at);
			if (!Boolean(row.active)) { await tx`UPDATE role_subscriptions SET status='cancelled',next_charge_at=NULL,last_error='상품이 비활성화되었습니다.' WHERE id=${id}`; return false; }
			const duplicate = await tx`SELECT id FROM automatic_payment_runs WHERE payment_type='role_subscription' AND reference_id=${id} AND run_key=${runKey}`;
			if (duplicate.length) { await tx`UPDATE role_subscriptions SET next_charge_at=${nextRoleChargeAt(now)} WHERE id=${id}`; return false; }
			await tx`INSERT IGNORE INTO accounts (guild_id,user_id) VALUES (${guildId},${userId})`;
			const accounts = await tx`SELECT balance FROM accounts WHERE guild_id=${guildId} AND user_id=${userId} FOR UPDATE`;
			if (!accounts.length || moneyToCents(money(accounts[0].balance)) < moneyToCents(amount)) {
				await tx`INSERT INTO automatic_payment_runs (payment_type,reference_id,run_key,guild_id,amount,status,error_message) VALUES ('role_subscription',${id},${runKey},${guildId},${amount},'failed','잔액 부족으로 자동 해지')`;
				await tx`UPDATE role_subscriptions SET status='cancelled',next_charge_at=NULL,last_error='잔액 부족으로 자동 해지되었습니다.' WHERE id=${id}`;
				return false;
			}
			await tx`UPDATE accounts SET balance=balance-${amount} WHERE guild_id=${guildId} AND user_id=${userId}`;
			await tx`INSERT INTO transactions (guild_id,sender_id,recipient_id,amount,transaction_type) VALUES (${guildId},${userId},${null},${amount},'role_subscription')`;
			await tx`INSERT INTO automatic_payment_runs (payment_type,reference_id,run_key,guild_id,amount,status) VALUES ('role_subscription',${id},${runKey},${guildId},${amount},'success')`;
			await tx`UPDATE role_subscriptions SET next_charge_at=${nextRoleChargeAt(now)},last_error=NULL WHERE id=${id}`;
			return amount;
		});
		if (success) completed.push({ guildId, userId, amount: success });
		const state = await db`SELECT status FROM role_subscriptions WHERE id=${id}`;
		if (state[0]?.status === 'cancelled') await removeGuildMemberRole(guildId, userId, roleId).catch(console.error);
	}
	return completed;
}
