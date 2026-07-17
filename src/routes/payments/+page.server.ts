import { getSessionUser } from '$lib/server/auth';
import {
	cancelRoleSubscription, cancelScheduledTransfer, createScheduledTransfer,
	getUserAutomaticPayments, listRolePlans, subscribeRole
} from '$lib/server/db/automatic-payments';
import { getDB } from '$lib/server/db';
import { ensureUser } from '$lib/server/db/users';
import { addGuildMemberRole, getGuildMember, removeGuildMemberRole } from '$lib/server/discord/users';
import { parseMoney } from '$lib/server/economy/money';
import { fail, redirect } from '@sveltejs/kit';
import { sendTransactionNotification } from '$lib/server/bot/notifications';
import type { Actions, PageServerLoad } from './$types';

async function membership(cookies: Parameters<typeof getSessionUser>[0], guildId: string) {
	const user = await getSessionUser(cookies);
	if (!user) return null;
	const db = await getDB();
	const rows = await db`SELECT guild_name FROM user_guilds WHERE user_id=${user.id} AND guild_id=${guildId}`;
	return rows.length ? user : null;
}

export const load: PageServerLoad = async ({ cookies, url }) => {
	const user = await getSessionUser(cookies);
	if (!user) redirect(303, '/login');
	const db = await getDB();
	const rows = await db`SELECT guild_id,guild_name FROM user_guilds WHERE user_id=${user.id} ORDER BY guild_name`;
	const guilds = rows.map((r: Record<string, unknown>) => ({ id: String(r.guild_id), name: String(r.guild_name) }));
	const requested = url.searchParams.get('guild');
	const selectedGuildId = guilds.some((g: { id: string }) => g.id === requested) ? requested : guilds[0]?.id || null;
	const [plans, payments] = selectedGuildId
		? await Promise.all([listRolePlans(selectedGuildId), getUserAutomaticPayments(selectedGuildId, user.id)])
		: [[], { subscriptions: [], transfers: [], runs: [] }];
	return { user, guilds, selectedGuildId, plans, ...payments };
};

export const actions: Actions = {
	subscribe: async ({ cookies, request }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || ''), planId = String(form.get('planId') || '');
		const user = await membership(cookies, guildId);
		if (!user) return fail(403, { message: '서버 접근 권한이 없습니다.' });
		const db = await getDB();
		const plans = await db`SELECT role_id FROM role_subscription_plans WHERE id=${planId} AND guild_id=${guildId} AND active=TRUE`;
		if (!plans.length) return fail(404, { message: '구독 상품을 찾을 수 없습니다.' });
		try {
			await addGuildMemberRole(guildId, user.id, String(plans[0].role_id));
			const payment = await subscribeRole(guildId, user.id, planId);
			await sendTransactionNotification(guildId, `🎨 **역할 구독 가입**\n사용자: <@${user.id}>\n역할: <@&${String(plans[0].role_id)}>\n금액: **${payment.price}**`);
			return { success: true, message: '가입 결제가 완료되어 역할을 지급했습니다.' };
		} catch (error) {
			await removeGuildMemberRole(guildId, user.id, String(plans[0].role_id)).catch(() => undefined);
			if (error instanceof Error && error.message === 'ACTIVE_ROLE_SUBSCRIPTION') return fail(400, { message: '이미 활성 역할 구독이 있습니다.' });
			if (error instanceof Error && error.name === 'InsufficientBalanceError') return fail(400, { message: '소지금이 부족합니다.' });
			throw error;
		}
	},
	cancelSubscription: async ({ cookies, request }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || ''), id = String(form.get('id') || '');
		const user = await membership(cookies, guildId);
		if (!user) return fail(403, { message: '서버 접근 권한이 없습니다.' });
		const db = await getDB();
		const rows = await db`SELECT rp.role_id FROM role_subscriptions rs JOIN role_subscription_plans rp ON rp.id=rs.plan_id WHERE rs.id=${id} AND rs.guild_id=${guildId} AND rs.user_id=${user.id}`;
		await cancelRoleSubscription(guildId, user.id, id);
		if (rows.length) await removeGuildMemberRole(guildId, user.id, String(rows[0].role_id)).catch(console.error);
		return { success: true, message: '역할 구독을 해지했습니다.' };
	},
	createTransfer: async ({ cookies, request }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || ''), recipientId = String(form.get('recipientId') || '');
		const user = await membership(cookies, guildId), amount = parseMoney(String(form.get('amount') || ''));
		if (!user) return fail(403, { message: '서버 접근 권한이 없습니다.' });
		if (!amount || recipientId === user.id) return fail(400, { message: '받는 사람과 0.01 이상의 금액을 확인해 주세요.' });
		const member = await getGuildMember(guildId, recipientId);
		if (!member || member.user.bot) return fail(400, { message: '같은 서버의 사용자를 선택해 주세요.' });
		await ensureUser(member.user.id, member.nick || member.user.global_name || member.user.username, member.user.avatar || '');
		const type = String(form.get('scheduleType')) as 'interval' | 'weekly' | 'monthly';
		const hour = Number(form.get('hour')), minute = Number(form.get('minute'));
		if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return fail(400, { message: '실행 시간을 확인해 주세요.' });
		const value = Number(form.get('scheduleValue'));
		const valid = Number.isInteger(value) && ((type === 'interval' && value >= 1 && value <= 365) || (type === 'weekly' && value >= 0 && value <= 6) || (type === 'monthly' && value >= 1 && value <= 28));
		if (!valid) return fail(400, { message: '주기 값을 확인해 주세요.' });
		const schedule = type === 'interval' ? { type, intervalDays: value, hour, minute } as const : type === 'weekly' ? { type, weekday: value, hour, minute } as const : { type, monthDay: value, hour, minute } as const;
		await createScheduledTransfer(guildId, user.id, recipientId, amount, schedule);
		return { success: true, message: '자동 송금을 등록했습니다. 최초 결제는 표시된 다음 실행 시각에 진행됩니다.' };
	},
	cancelTransfer: async ({ cookies, request }) => {
		const form = await request.formData(); const guildId = String(form.get('guildId') || '');
		const user = await membership(cookies, guildId); if (!user) return fail(403, { message: '서버 접근 권한이 없습니다.' });
		await cancelScheduledTransfer(guildId, user.id, String(form.get('id') || ''));
		return { success: true, message: '자동 송금을 해지했습니다.' };
	}
};
