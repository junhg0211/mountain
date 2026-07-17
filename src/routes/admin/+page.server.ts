import { getSessionUser } from '$lib/server/auth';
import { sendTransactionNotification } from '$lib/server/bot/notifications';
import {
	adjustBalance,
	getTotalSupply,
	InsufficientBalanceError,
	type BalanceAdjustmentType
} from '$lib/server/db/accounts';
import { getDB } from '$lib/server/db';
import {
	setAttendanceReward,
	setCurrencyUnit,
	setNotificationChannel,
	setVoiceActivitySettings,
	setVisibilitySettings
} from '$lib/server/db/guild-settings';
import { canManageGuild } from '$lib/server/db/user-guilds';
import { ensureUser } from '$lib/server/db/users';
import { getGuildMember, getGuildTextChannels } from '$lib/server/discord/users';
import { moneyToCents, parseMoney } from '$lib/server/economy/money';
import { formatMoneyDisplay } from '$lib/economy/money-display';
import { fail, redirect } from '@sveltejs/kit';
import type { Cookies } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, url }) => {
	const user = await getSessionUser(cookies);
	if (!user) redirect(303, '/login');
	const db = await getDB();
	const rows = await db`
		SELECT ug.guild_id, ug.guild_name, ug.permissions,
			COALESCE(gs.currency_unit, 'coin') AS currency_unit,
			COALESCE(gs.public_balance_enabled, TRUE) AS public_balance_enabled,
			COALESCE(gs.ranking_enabled, TRUE) AS ranking_enabled,
			COALESCE(gs.attendance_reward, 0.00) AS attendance_reward,
			COALESCE(gs.voice_activity_reward, 0.00) AS voice_activity_reward,
			COALESCE(gs.voice_activity_daily_cap, 0.00) AS voice_activity_daily_cap,
			gs.notification_channel_id
		FROM user_guilds ug
		LEFT JOIN guild_settings gs ON gs.guild_id = ug.guild_id
		WHERE ug.user_id = ${user.id}
		ORDER BY ug.guild_name
	`;
	const guilds = rows
		.filter((row: { permissions: unknown }) => canManageGuild(String(row.permissions)))
		.map(
			(row: {
				guild_id: unknown;
				guild_name: unknown;
				currency_unit: unknown;
				public_balance_enabled: unknown;
				ranking_enabled: unknown;
				attendance_reward: unknown;
				voice_activity_reward: unknown;
				voice_activity_daily_cap: unknown;
				notification_channel_id: unknown;
			}) => ({
				id: String(row.guild_id),
				name: String(row.guild_name),
				currencyUnit: String(row.currency_unit),
				publicBalanceEnabled: Boolean(row.public_balance_enabled),
				rankingEnabled: Boolean(row.ranking_enabled),
				attendanceReward: Number(row.attendance_reward).toFixed(2),
				voiceActivityReward: Number(row.voice_activity_reward).toFixed(2),
				voiceActivityDailyCap: Number(row.voice_activity_daily_cap).toFixed(2),
				notificationChannelId: row.notification_channel_id
					? String(row.notification_channel_id)
					: null
			})
		);
	const requested = url.searchParams.get('guild');
	const selectedGuildId = guilds.some((guild: { id: string }) => guild.id === requested)
		? requested
		: guilds[0]?.id || null;
	const totalSupply = selectedGuildId ? await getTotalSupply(selectedGuildId) : '0.00';
	const channels = selectedGuildId ? await getGuildTextChannels(selectedGuildId) : [];
	return { user, guilds, selectedGuildId, totalSupply, channels };
};

async function handleAdjustment(cookies: Cookies, request: Request, type: BalanceAdjustmentType) {
	const user = await getSessionUser(cookies);
	if (!user) return fail(401, { message: '로그인이 필요합니다.' });
	const form = await request.formData();
	const guildId = String(form.get('guildId') || '');
	const targetId = String(form.get('targetId') || '');
	const amount = parseMoney(String(form.get('amount') || '').trim());
	if (!amount) return fail(400, { message: '0.01 이상의 올바른 금액을 입력해 주세요.' });
	if (!/^\d{17,20}$/.test(targetId))
		return fail(400, { message: '검색 결과에서 사용자를 선택해 주세요.' });
	const db = await getDB();
	const permissions =
		await db`SELECT permissions FROM user_guilds WHERE user_id=${user.id} AND guild_id=${guildId} LIMIT 1`;
	if (permissions.length !== 1 || !canManageGuild(String(permissions[0].permissions)))
		return fail(403, { message: '서버 관리 권한이 필요합니다.' });
	const member = await getGuildMember(guildId, targetId);
	if (!member || member.user.bot)
		return fail(400, { message: '같은 서버의 사용자를 선택해 주세요.' });
	await ensureUser(
		member.user.id,
		member.nick || member.user.global_name || member.user.username,
		member.user.avatar || ''
	);
	try {
		const balance = await adjustBalance(guildId, targetId, amount, type);
		await sendTransactionNotification(
			guildId,
			`🏦 **${type === 'mint' ? 'Mint · 발행' : 'Burn · 소각'}**\n대상: <@${targetId}>\n금액: **${formatMoneyDisplay(amount)}**\n처리 관리자: <@${user.id}>\n처리 후 잔액: **${formatMoneyDisplay(balance)}**`
		);
		return {
			success: true,
			message: `${member.nick || member.user.username}님에게 ${formatMoneyDisplay(amount)}을 ${type === 'mint' ? '발행' : '소각'}했습니다. 현재 소지금: ${formatMoneyDisplay(balance)}`
		};
	} catch (error) {
		if (error instanceof InsufficientBalanceError)
			return fail(400, { message: '대상 사용자의 소지금보다 많이 소각할 수 없습니다.' });
		throw error;
	}
}

export const actions: Actions = {
	settings: async ({ cookies, request }) => {
		const user = await getSessionUser(cookies);
		if (!user) return fail(401, { message: '로그인이 필요합니다.' });
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const unit = String(form.get('unit') || '').trim();
		const db = await getDB();
		const rows =
			await db`SELECT permissions FROM user_guilds WHERE user_id=${user.id} AND guild_id=${guildId} LIMIT 1`;
		if (rows.length !== 1 || !canManageGuild(String(rows[0].permissions)))
			return fail(403, { message: '서버 관리 권한이 필요합니다.' });
		if (!unit || unit.length > 16)
			return fail(400, { message: '경제 단위는 1~16자로 입력해 주세요.' });
		await setCurrencyUnit(guildId, unit);
		return { success: true, message: `경제 단위를 ${unit}(으)로 변경했습니다.` };
	},
	attendance: async ({ cookies, request }) => {
		const user = await getSessionUser(cookies);
		if (!user) return fail(401, { message: '로그인이 필요합니다.' });
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const rawAmount = String(form.get('amount') || '').trim();
		const amount =
			rawAmount === '0' || /^0\.0{1,2}$/.test(rawAmount) ? '0.00' : parseMoney(rawAmount);
		if (!amount)
			return fail(400, {
				message: '0 또는 0.01 이상의 금액을 소수점 둘째 자리까지 입력해 주세요.'
			});
		const db = await getDB();
		const rows = await db`
			SELECT permissions FROM user_guilds
			WHERE user_id=${user.id} AND guild_id=${guildId} LIMIT 1
		`;
		if (rows.length !== 1 || !canManageGuild(String(rows[0].permissions)))
			return fail(403, { message: '서버 관리 권한이 필요합니다.' });
		await setAttendanceReward(guildId, amount);
		return {
			success: true,
			message:
				amount === '0.00'
					? '출석 보상을 비활성화했습니다.'
					: `일일 출석 보상을 ${amount}(으)로 설정했습니다.`
		};
	},
	voiceActivity: async ({ cookies, request }) => {
		const user = await getSessionUser(cookies);
		if (!user) return fail(401, { message: '로그인이 필요합니다.' });
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const rawReward = String(form.get('reward') || '').trim();
		const rawDailyCap = String(form.get('dailyCap') || '').trim();
		const db = await getDB();
		const permissionRows = await db`
			SELECT permissions FROM user_guilds
			WHERE user_id=${user.id} AND guild_id=${guildId} LIMIT 1
		`;
		if (permissionRows.length !== 1 || !canManageGuild(String(permissionRows[0].permissions)))
			return fail(403, { message: '서버 관리 권한이 없습니다.' });
		const disabled = /^0(?:\.0{1,2})?$/.test(rawReward) && /^0(?:\.0{1,2})?$/.test(rawDailyCap);
		const reward = disabled ? '0.00' : parseMoney(rawReward);
		const dailyCap = disabled ? '0.00' : parseMoney(rawDailyCap);
		if (!reward || !dailyCap)
			return fail(400, { message: '보상과 일일 한도는 0.01 이상의 금액으로 입력해 주세요.' });
		if (!disabled && moneyToCents(dailyCap) < moneyToCents(reward) * 2n)
			return fail(400, { message: '일일 한도는 2인 채널 1회 보상보다 작을 수 없습니다.' });
		await setVoiceActivitySettings(guildId, { reward, dailyCap });
		return {
			success: true,
			message: disabled
				? '음성 활동 보상을 비활성화했습니다.'
				: `음성 활동 기본 보상을 ${formatMoneyDisplay(reward)}, 일일 한도를 ${formatMoneyDisplay(dailyCap)}(으)로 설정했습니다.`
		};
	},
	visibility: async ({ cookies, request }) => {
		const user = await getSessionUser(cookies);
		if (!user) return fail(401, { message: '로그인이 필요합니다.' });
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const db = await getDB();
		const rows =
			await db`SELECT permissions FROM user_guilds WHERE user_id=${user.id} AND guild_id=${guildId} LIMIT 1`;
		if (rows.length !== 1 || !canManageGuild(String(rows[0].permissions)))
			return fail(403, { message: '서버 관리 권한이 필요합니다.' });
		await setVisibilitySettings(guildId, {
			publicBalanceEnabled: form.get('publicBalanceEnabled') === 'on',
			rankingEnabled: form.get('rankingEnabled') === 'on'
		});
		return { success: true, message: '공개 범위 설정을 저장했습니다.' };
	},
	notifications: async ({ cookies, request }) => {
		const user = await getSessionUser(cookies);
		if (!user) return fail(401, { message: '로그인이 필요합니다.' });
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const channelId = String(form.get('channelId') || '') || null;
		const db = await getDB();
		const rows =
			await db`SELECT permissions FROM user_guilds WHERE user_id=${user.id} AND guild_id=${guildId} LIMIT 1`;
		if (rows.length !== 1 || !canManageGuild(String(rows[0].permissions)))
			return fail(403, { message: '서버 관리 권한이 필요합니다.' });
		if (channelId) {
			const channels = await getGuildTextChannels(guildId);
			if (!channels.some((channel) => channel.id === channelId))
				return fail(400, { message: '유효한 텍스트 채널을 선택해 주세요.' });
		}
		await setNotificationChannel(guildId, channelId);
		return {
			success: true,
			message: channelId ? '거래 알림 채널을 저장했습니다.' : '거래 알림을 비활성화했습니다.'
		};
	},
	mint: async ({ cookies, request }) => handleAdjustment(cookies, request, 'mint'),
	burn: async ({ cookies, request }) => handleAdjustment(cookies, request, 'burn')
};
