import { getSessionUser } from '$lib/server/auth';
import { sendTransactionNotification } from '$lib/server/bot/notifications';
import { getDB } from '$lib/server/db';
import {
	BettingPoolClosedError,
	BettingPoolNotFoundError,
	BettingParticipantError,
	BettingPermissionError,
	BettingOptionError,
	archiveBettingPool,
	getBettingPoolExtras,
	getBettingPool,
	placeBet,
	placeTeamBet,
	refundBettingPool,
	reopenBettingPool,
	settleBettingPool,
	settleTeamBettingPool
} from '$lib/server/db/betting';
import { getCurrencyUnit } from '$lib/server/db/guild-settings';
import { canManageGuild } from '$lib/server/db/user-guilds';
import { parseMoney } from '$lib/server/economy/money';
import { formatMoneyDisplay } from '$lib/economy/money-display';
import { publishBettingUpdate } from '$lib/server/realtime';
import { InsufficientBalanceError } from '$lib/server/db/accounts';
import { getOrCreateBalance } from '$lib/server/db/accounts';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const ALLOWED_AMOUNTS = new Set([
	'0.01',
	'0.05',
	'0.10',
	'0.50',
	'1.00',
	'5.00',
	'10.00',
	'50.00',
	'100.00',
	'500.00'
]);

async function requireContext(cookies: Parameters<typeof getSessionUser>[0], guildId: string) {
	const user = await getSessionUser(cookies);
	if (!user) return null;
	const db = await getDB();
	const rows = await db`
		SELECT permissions FROM user_guilds
		WHERE user_id=${user.id} AND guild_id=${guildId} LIMIT 1
	`;
	return rows.length === 1 ? { user, permissions: String(rows[0].permissions) } : null;
}

export const load: PageServerLoad = async ({ cookies, params, url }) => {
	const guildId = url.searchParams.get('guild') || '';
	const user = await requireContext(cookies, guildId);
	if (!user) redirect(303, '/login');
	const pool = await getBettingPool(guildId, params.poolId);
	if (!pool) redirect(303, `/bets?guild=${encodeURIComponent(guildId)}`);
	const extras = await getBettingPoolExtras(guildId, params.poolId, user.user.id);
	return {
		user: user.user,
		guildId,
		pool,
		...extras,
		currencyUnit: await getCurrencyUnit(guildId),
		balance: await getOrCreateBalance(guildId, user.user.id),
		canManage: pool.ownerId === user.user.id || canManageGuild(user.permissions)
	};
};

export const actions: Actions = {
	bet: async ({ cookies, params, request, url }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || url.searchParams.get('guild') || '');
		const context = await requireContext(cookies, guildId);
		if (!context) return fail(401, { message: '로그인이 필요합니다.' });
		const amount = parseMoney(String(form.get('amount') || ''));
		const optionKey = String(form.get('optionKey') || '');
		if (!amount || !ALLOWED_AMOUNTS.has(amount))
			return fail(400, { message: '버튼에 표시된 금액 단위만 베팅할 수 있습니다.' });
		try {
			const currentPool = await getBettingPool(guildId, params.poolId);
			if (currentPool?.bettingMode === 'team') {
				if (optionKey !== 'A' && optionKey !== 'B')
					return fail(400, { message: 'A팀 또는 B팀을 선택해 주세요.' });
				await placeTeamBet(guildId, params.poolId, context.user.id, optionKey, amount);
			} else {
				await placeBet(guildId, params.poolId, context.user.id, amount);
			}
			const pool = await getBettingPool(guildId, params.poolId);
			publishBettingUpdate(guildId, params.poolId);
			await sendTransactionNotification(
				guildId,
				`🎟️ **베팅 참가**\n#${params.poolId} ${pool?.title || ''}\n참가자: <@${context.user.id}>${pool?.bettingMode === 'team' ? `\n선택: **${optionKey}팀**` : ''}\n추가 베팅: **${formatMoneyDisplay(amount)}**\n판돈: **${formatMoneyDisplay(pool?.totalAmount || amount)}**`
			);
			redirect(303, `/bets/${params.poolId}?guild=${encodeURIComponent(guildId)}&bet=success`);
		} catch (error) {
			if (error instanceof InsufficientBalanceError)
				return fail(400, { message: '베팅할 소지금이 부족합니다.' });
			if (error instanceof BettingPoolClosedError)
				return fail(409, { message: '이미 종료된 베팅 판입니다.' });
			if (error instanceof BettingPoolNotFoundError)
				return fail(404, { message: '베팅 판을 찾을 수 없습니다.' });
			if (error instanceof BettingOptionError)
				return fail(400, { message: '처음 선택한 팀에만 추가 베팅할 수 있습니다.' });
			throw error;
		}
	},
	settle: async ({ cookies, params, request }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const winningOption = String(form.get('winningOption') || '');
		const winnerId = String(form.get('winnerId') || '');
		const context = await requireContext(cookies, guildId);
		if (!context) return fail(401, { message: '로그인이 필요합니다.' });
		try {
			const pool = await getBettingPool(guildId, params.poolId);
			if (pool?.bettingMode !== 'team') {
				const payout = await settleBettingPool(
					guildId,
					params.poolId,
					context.user.id,
					winnerId,
					canManageGuild(context.permissions)
				);
				publishBettingUpdate(guildId, params.poolId);
				await sendTransactionNotification(
					guildId,
					`🏆 **베팅 정산**\n#${params.poolId}\n승자: <@${winnerId}>\n지급액: **${formatMoneyDisplay(payout)}**`
				);
				redirect(303, `/bets/${params.poolId}?guild=${encodeURIComponent(guildId)}`);
			}
			if (winningOption !== 'A' && winningOption !== 'B')
				return fail(400, { message: '승리 팀을 선택해 주세요.' });
			const result = await settleTeamBettingPool(
				guildId,
				params.poolId,
				context.user.id,
				winningOption,
				canManageGuild(context.permissions)
			);
			publishBettingUpdate(guildId, params.poolId);
			await sendTransactionNotification(
				guildId,
				`🏆 **팀 베팅 정산**\n#${params.poolId}\n승리: **${winningOption}팀**\n총 지급액: **${formatMoneyDisplay(result.total)}** · ${result.winnerCount}명\n처리자: <@${context.user.id}>`
			);
			redirect(303, `/bets/${params.poolId}?guild=${encodeURIComponent(guildId)}`);
		} catch (error) {
			return managementError(error);
		}
	},
	refund: async ({ cookies, params, request }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const context = await requireContext(cookies, guildId);
		if (!context) return fail(401, { message: '로그인이 필요합니다.' });
		try {
			const pool = await getBettingPool(guildId, params.poolId);
			const count = await refundBettingPool(
				guildId,
				params.poolId,
				context.user.id,
				canManageGuild(context.permissions)
			);
			publishBettingUpdate(guildId, params.poolId);
			await sendTransactionNotification(
				guildId,
				`↩️ **베팅 환불**\n#${params.poolId} ${pool?.title || ''}\n${count}명에게 총 **${pool?.totalAmount || '0.00'}** 환불\n처리자: <@${context.user.id}>`
			);
			redirect(303, `/bets/${params.poolId}?guild=${encodeURIComponent(guildId)}`);
		} catch (error) {
			return managementError(error);
		}
	},
	reopen: async ({ cookies, params, request }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const context = await requireContext(cookies, guildId);
		if (!context) return fail(401, { message: '로그인이 필요합니다.' });
		try {
			await reopenBettingPool(guildId, params.poolId, context.user.id, canManageGuild(context.permissions));
			publishBettingUpdate(guildId, params.poolId);
			await sendTransactionNotification(guildId, `🔄 **베팅 판 새 회차 시작**\n#${params.poolId}\n기존 참가자 명단을 유지하고 베팅 금액을 초기화했습니다.\n처리자: <@${context.user.id}>`);
			redirect(303, `/bets/${params.poolId}?guild=${encodeURIComponent(guildId)}`);
		} catch (error) { return managementError(error); }
	},
	archive: async ({ cookies, params, request }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const context = await requireContext(cookies, guildId);
		if (!context) return fail(401, { message: '로그인이 필요합니다.' });
		try {
			const refunded = await archiveBettingPool(guildId, params.poolId, context.user.id, canManageGuild(context.permissions));
			publishBettingUpdate(guildId, params.poolId);
			await sendTransactionNotification(guildId, `⛔ **베팅 판 완전 종료**\n#${params.poolId}${refunded ? `\n진행 중이던 ${refunded}명의 베팅액을 환불했습니다.` : ''}\n처리자: <@${context.user.id}>`);
			redirect(303, `/bets?guild=${encodeURIComponent(guildId)}`);
		} catch (error) { return managementError(error); }
	}
};

function managementError(error: unknown) {
	if (error instanceof BettingPoolNotFoundError)
		return fail(404, { message: '베팅 판을 찾을 수 없습니다.' });
	if (error instanceof BettingPoolClosedError)
		return fail(409, { message: '이미 종료된 베팅 판입니다.' });
	if (error instanceof BettingPermissionError)
		return fail(403, { message: '판 주인만 처리할 수 있습니다.' });
	if (error instanceof BettingParticipantError)
		return fail(400, { message: '참가자 중 승자를 선택해 주세요.' });
	throw error;
}
