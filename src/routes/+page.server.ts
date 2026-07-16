import { deleteSession, getSessionUser } from '$lib/server/auth';
import { sendTransactionNotification } from '$lib/server/bot/notifications';
import {
	getBalanceRanking,
	getUserTransactions,
	InsufficientBalanceError,
	transferBalance
} from '$lib/server/db/accounts';
import { getDB } from '$lib/server/db';
import {
	AttendanceAlreadyClaimedError,
	AttendanceDisabledError,
	claimAttendance,
	getAttendanceStatus
} from '$lib/server/db/attendance';
import {
	BettingParticipantError,
	BettingPermissionError,
	BettingPoolClosedError,
	BettingPoolNotFoundError,
	createBettingPool,
	getBettingPool,
	getBettingPools,
	placeBet,
	refundBettingPool,
	settleBettingPool
} from '$lib/server/db/betting';
import { canManageGuild } from '$lib/server/db/user-guilds';
import { getCurrencyUnit } from '$lib/server/db/guild-settings';
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
		rankingEnabled: Boolean(row.ranking_enabled),
		canManage: canManageGuild(String(row.permissions))
	}));
	const requestedGuildId = url.searchParams.get('guild');
	const selectedGuildId = guilds.some((guild: { id: string }) => guild.id === requestedGuildId)
		? requestedGuildId
		: guilds[0]?.id || null;

	const rankingEnabled =
		selectedGuildId &&
		guilds.find((guild: { id: string }) => guild.id === selectedGuildId)?.rankingEnabled;
	const [ranking, transactions, bettingPools, attendance] = selectedGuildId
		? await Promise.all([
				rankingEnabled ? getBalanceRanking(selectedGuildId) : Promise.resolve([]),
				getUserTransactions(selectedGuildId, user.id),
				getBettingPools(selectedGuildId),
				getAttendanceStatus(selectedGuildId, user.id)
			])
		: [[], [], [], null];
	return {
		user,
		guilds,
		selectedGuildId,
		ranking,
		transactions,
		bettingPools,
		attendance
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
	attendance: async ({ cookies, request }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const membership = await requireMembership(cookies, guildId);
		if (!membership) return fail(401, { message: '서버 접근 권한이 없습니다.' });
		try {
			const [result, unit] = await Promise.all([
				claimAttendance(guildId, membership.user.id),
				getCurrencyUnit(guildId)
			]);
			await sendTransactionNotification(
				guildId,
				`📅 **출석 보상**\n사용자: <@${membership.user.id}>\n지급액: **${result.reward} ${unit}**\n지급 후 잔액: **${result.balance} ${unit}**`
			);
			return {
				success: true,
				message: `출석 완료! ${result.reward} ${unit}을(를) 받았습니다. 현재 소지금: ${result.balance} ${unit}`
			};
		} catch (error) {
			if (error instanceof AttendanceAlreadyClaimedError)
				return fail(409, { message: '오늘은 이미 출석 보상을 받았습니다.' });
			if (error instanceof AttendanceDisabledError)
				return fail(403, { message: '이 서버는 출석 보상을 사용하지 않습니다.' });
			throw error;
		}
	},
	createBet: async ({ cookies, request }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const title = String(form.get('title') || '').trim();
		const membership = await requireMembership(cookies, guildId);
		if (!membership) return fail(401, { message: '서버 접근 권한이 없습니다.' });
		if (!title || title.length > 80)
			return fail(400, { message: '베팅 판 제목은 1~80자로 입력해 주세요.' });
		const poolId = await createBettingPool(guildId, membership.user.id, title);
		await sendTransactionNotification(
			guildId,
			`🎲 **베팅 판 생성**\n#${poolId} ${title}\n판 주인: <@${membership.user.id}>`
		);
		return { success: true, message: `#${poolId} ${title} 베팅 판을 만들었습니다.` };
	},
	placeBet: async ({ cookies, request }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const poolId = String(form.get('poolId') || '');
		const amount = parseMoney(String(form.get('amount') || '').trim());
		const membership = await requireMembership(cookies, guildId);
		if (!membership) return fail(401, { message: '서버 접근 권한이 없습니다.' });
		if (!/^\d+$/.test(poolId)) return fail(400, { message: '올바른 베팅 판을 선택해 주세요.' });
		if (!amount) return fail(400, { message: '0.01 이상의 올바른 금액을 입력해 주세요.' });
		try {
			const remaining = await placeBet(guildId, poolId, membership.user.id, amount);
			const pool = await getBettingPool(guildId, poolId);
			await sendTransactionNotification(
				guildId,
				`🎟️ **베팅 참가**\n#${poolId} ${pool?.title || ''}\n참가자: <@${membership.user.id}>\n추가 베팅: **${amount}**\n판돈: **${pool?.totalAmount || amount}**`
			);
			return { success: true, message: `${amount}을 베팅했습니다. 남은 소지금: ${remaining}` };
		} catch (error) {
			return bettingActionError(error);
		}
	},
	settleBet: async ({ cookies, request }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const poolId = String(form.get('poolId') || '');
		const winnerId = String(form.get('winnerId') || '');
		const membership = await requireMembership(cookies, guildId);
		if (!membership) return fail(401, { message: '서버 접근 권한이 없습니다.' });
		if (!/^\d+$/.test(poolId) || !/^\d{17,20}$/.test(winnerId))
			return fail(400, { message: '정산할 판과 승자를 올바르게 선택해 주세요.' });
		try {
			const payout = await settleBettingPool(
				guildId,
				poolId,
				membership.user.id,
				winnerId,
				canManageGuild(membership.permissions)
			);
			const pool = await getBettingPool(guildId, poolId);
			await sendTransactionNotification(
				guildId,
				`🏆 **베팅 정산**\n#${poolId} ${pool?.title || ''}\n승자: <@${winnerId}>\n지급액: **${payout}**\n처리자: <@${membership.user.id}>`
			);
			return {
				success: true,
				message: `${pool?.winnerName || '승자'}님에게 ${payout}을 지급했습니다.`
			};
		} catch (error) {
			return bettingActionError(error);
		}
	},
	refundBet: async ({ cookies, request }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const poolId = String(form.get('poolId') || '');
		const membership = await requireMembership(cookies, guildId);
		if (!membership) return fail(401, { message: '서버 접근 권한이 없습니다.' });
		if (!/^\d+$/.test(poolId)) return fail(400, { message: '올바른 베팅 판을 선택해 주세요.' });
		try {
			const poolBefore = await getBettingPool(guildId, poolId);
			const count = await refundBettingPool(
				guildId,
				poolId,
				membership.user.id,
				canManageGuild(membership.permissions)
			);
			await sendTransactionNotification(
				guildId,
				`↩️ **베팅 환불**\n#${poolId} ${poolBefore?.title || ''}\n${count}명에게 총 **${poolBefore?.totalAmount || '0.00'}** 환불\n처리자: <@${membership.user.id}>`
			);
			return { success: true, message: `${count}명의 베팅액을 모두 환불했습니다.` };
		} catch (error) {
			return bettingActionError(error);
		}
	}
};

function bettingActionError(error: unknown) {
	if (error instanceof InsufficientBalanceError)
		return fail(400, { message: '베팅할 소지금이 부족합니다.' });
	if (error instanceof BettingPoolNotFoundError)
		return fail(404, { message: '베팅 판을 찾을 수 없습니다.' });
	if (error instanceof BettingPoolClosedError)
		return fail(409, { message: '이미 종료된 베팅 판입니다.' });
	if (error instanceof BettingPermissionError)
		return fail(403, { message: '판 주인만 정산하거나 환불할 수 있습니다.' });
	if (error instanceof BettingParticipantError)
		return fail(400, { message: '베팅에 참가한 사용자 중 승자를 선택해 주세요.' });
	throw error;
}
