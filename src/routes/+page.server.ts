import { deleteSession, getSessionUser } from '$lib/server/auth';
import { sendTransactionNotification } from '$lib/server/bot/notifications';
import {
	getBalanceRanking,
	getOrCreateBalance,
	InsufficientBalanceError,
	transferBalance
} from '$lib/server/db/accounts';
import { getDB } from '$lib/server/db';
import { getVisibilitySettings } from '$lib/server/db/guild-settings';
import { canManageGuild } from '$lib/server/db/user-guilds';
import { ensureUser } from '$lib/server/db/users';
import { getGuildMember } from '$lib/server/discord/users';
import { parseMoney } from '$lib/server/economy/money';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

interface GuildRow {
	guild_id: unknown;
	guild_name: unknown;
	icon_hash: unknown;
	permissions: unknown;
	balance: unknown;
	currency_unit: unknown;
	public_balance_enabled: unknown;
	ranking_enabled: unknown;
}

export const load: PageServerLoad = async ({ cookies, url }) => {
	const user = await getSessionUser(cookies);
	if (!user) return { user, guilds: [], selectedGuildId: null };

	const db = await getDB();
	const guildRows = await db`
		SELECT ug.guild_id, ug.guild_name, ug.icon_hash, ug.permissions,
			COALESCE(a.balance, 0.00) AS balance,
			COALESCE(gs.currency_unit, 'coin') AS currency_unit,
			COALESCE(gs.public_balance_enabled, TRUE) AS public_balance_enabled,
			COALESCE(gs.ranking_enabled, TRUE) AS ranking_enabled
		FROM user_guilds ug
		LEFT JOIN accounts a ON a.guild_id = ug.guild_id AND a.user_id = ug.user_id
		LEFT JOIN guild_settings gs ON gs.guild_id = ug.guild_id
		WHERE ug.user_id = ${user.id}
		ORDER BY ug.guild_name
	`;
	const guilds = guildRows.map((row: GuildRow) => ({
		id: String(row.guild_id),
		name: String(row.guild_name),
		iconUrl: row.icon_hash
			? `https://cdn.discordapp.com/icons/${row.guild_id}/${row.icon_hash}.png`
			: null,
		balance: Number(row.balance).toFixed(2),
		currencyUnit: String(row.currency_unit),
		publicBalanceEnabled: Boolean(row.public_balance_enabled),
		rankingEnabled: Boolean(row.ranking_enabled),
		canManage: canManageGuild(String(row.permissions))
	}));
	const requestedGuildId = url.searchParams.get('guild');
	const selectedGuildId = guilds.some((guild: { id: string }) => guild.id === requestedGuildId)
		? requestedGuildId
		: guilds[0]?.id || null;

	const ranking =
		selectedGuildId &&
		guilds.find((guild: { id: string }) => guild.id === selectedGuildId)?.rankingEnabled
			? await getBalanceRanking(selectedGuildId)
			: [];
	return {
		user,
		guilds,
		selectedGuildId,
		ranking
	};
};

async function requireMembership(cookies: Parameters<typeof getSessionUser>[0], guildId: string) {
	const user = await getSessionUser(cookies);
	if (!user) return null;
	const db = await getDB();
	const rows = await db`
		SELECT permissions FROM user_guilds
		WHERE user_id = ${user.id} AND guild_id = ${guildId} LIMIT 1
	`;
	return rows.length === 1 ? { user, permissions: String(rows[0].permissions) } : null;
}

export const actions: Actions = {
	logout: async ({ cookies }) => {
		await deleteSession(cookies);
		redirect(303, '/');
	},
	transfer: async ({ cookies, request }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const recipientId = String(form.get('recipientId') || '');
		const amount = parseMoney(String(form.get('amount') || '').trim());
		const membership = await requireMembership(cookies, guildId);
		if (!membership)
			return fail(401, { message: '로그인이 필요하거나 서버 접근 권한이 없습니다.' });
		if (!amount)
			return fail(400, { message: '0.01 이상의 금액을 소수점 둘째 자리까지 입력해 주세요.' });
		if (recipientId === membership.user.id)
			return fail(400, { message: '자기 자신에게 송금할 수 없습니다.' });
		if (!/^\d{17,20}$/.test(recipientId))
			return fail(400, { message: '검색 결과에서 받는 사람을 선택해 주세요.' });

		const recipient = await getGuildMember(guildId, recipientId);
		if (!recipient || recipient.user.bot)
			return fail(400, { message: '같은 서버의 사용자를 선택해 주세요.' });
		await ensureUser(
			recipient.user.id,
			recipient.nick || recipient.user.global_name || recipient.user.username,
			recipient.user.avatar || ''
		);

		try {
			await transferBalance(guildId, membership.user.id, recipientId, amount);
			await sendTransactionNotification(
				guildId,
				`💸 **송금**\n보낸 사용자: <@${membership.user.id}>\n받는 사용자: <@${recipientId}>\n금액: **${amount}**`
			);
			return { success: true, message: `${amount} 송금이 완료됐습니다.` };
		} catch (error) {
			if (error instanceof InsufficientBalanceError)
				return fail(400, { message: '소지금이 부족합니다.' });
			throw error;
		}
	},
	lookup: async ({ cookies, request }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const targetId = String(form.get('targetId') || '');
		const membership = await requireMembership(cookies, guildId);
		if (!membership) return fail(401, { message: '서버 접근 권한이 없습니다.' });
		if (!/^\d{17,20}$/.test(targetId))
			return fail(400, { message: '검색 결과에서 사용자를 선택해 주세요.' });
		const visibility = await getVisibilitySettings(guildId);
		if (!visibility.publicBalanceEnabled)
			return fail(403, { message: '다른 사용자 소지금 조회가 비활성화되어 있습니다.' });
		const target = await getGuildMember(guildId, targetId);
		if (!target || target.user.bot)
			return fail(400, { message: '같은 서버의 사용자를 선택해 주세요.' });
		await ensureUser(
			target.user.id,
			target.nick || target.user.global_name || target.user.username,
			target.user.avatar || ''
		);
		const balance = await getOrCreateBalance(guildId, targetId);
		return {
			success: true,
			message: `${target.nick || target.user.username}님의 소지금은 ${balance}입니다.`,
			lookup: { username: target.nick || target.user.username, balance }
		};
	}
};
