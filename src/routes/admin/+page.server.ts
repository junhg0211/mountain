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
	setCurrencyUnit,
	setNotificationChannel,
	setVisibilitySettings
} from '$lib/server/db/guild-settings';
import { canManageGuild } from '$lib/server/db/user-guilds';
import { ensureUser } from '$lib/server/db/users';
import { getGuildMember, getGuildTextChannels } from '$lib/server/discord/users';
import { parseMoney } from '$lib/server/economy/money';
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
				notification_channel_id: unknown;
			}) => ({
				id: String(row.guild_id),
				name: String(row.guild_name),
				currencyUnit: String(row.currency_unit),
				publicBalanceEnabled: Boolean(row.public_balance_enabled),
				rankingEnabled: Boolean(row.ranking_enabled),
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
			`🏦 **${type === 'mint' ? 'Mint · 발행' : 'Burn · 소각'}**\n대상: <@${targetId}>\n금액: **${amount}**\n처리 관리자: <@${user.id}>\n처리 후 잔액: **${balance}**`
		);
		return {
			success: true,
			message: `${member.nick || member.user.username}님에게 ${amount}을 ${type === 'mint' ? '발행' : '소각'}했습니다. 현재 소지금: ${balance}`
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
