import { deleteSession, getSessionUser } from '$lib/server/auth';
import { sendTransactionNotification } from '$lib/server/bot/notifications';
import { getClient } from '$lib/server/bot';
import {
	getBalanceRanking,
	getUserTransactions,
	InsufficientBalanceError,
	transferBalance
} from '$lib/server/db/accounts';
import { getDB } from '$lib/server/db';
import {
	changeInventoryQuantity,
	getItemDefinition,
	getInventory,
	getItemMovements,
	InsufficientItemQuantityError,
	ItemNotFoundError,
	ItemNotForSaleError,
	ItemTradeLimitError,
	ItemNotUsableError,
	ItemStackLimitError,
	listItemDefinitions,
	tradeShopItem,
	useCurrencyItem
} from '$lib/server/db/items';
import {
	AttendanceAlreadyClaimedError,
	AttendanceDisabledError,
	claimAttendance,
	getAttendanceLeaderboard,
	getAttendanceStatus
} from '$lib/server/db/attendance';
import {
	BettingParticipantError,
	BettingPermissionError,
	BettingPoolClosedError,
	BettingPoolNotFoundError,
	createBettingPool,
	getBettingPool,
	placeBet,
	refundBettingPool,
	settleBettingPool
} from '$lib/server/db/betting';
import { canManageGuild } from '$lib/server/db/user-guilds';
import { getCurrencyUnit } from '$lib/server/db/guild-settings';
import { ensureUser } from '$lib/server/db/users';
import { getGuildMember } from '$lib/server/discord/users';
import { parseMoney } from '$lib/server/economy/money';
import { formatMoneyDisplay } from '$lib/economy/money-display';
import {
	getRecentDailyMemories,
	isValidMemoryDate,
	koreanDate,
	saveDailyMemory,
	yesterday
} from '$lib/server/db/daily-memories';
import { calculateVoiceReward, getVoiceActivityRemaining } from '$lib/server/db/voice-activity';
import { publishBettingUpdate } from '$lib/server/realtime';
import { fail, redirect } from '@sveltejs/kit';
import type { Cookies } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const DASHBOARD_NOTICE_COOKIE = 'mountain_dashboard_notice';

interface GuildRow {
	guild_id: unknown;
	guild_name: unknown;
	icon_hash: unknown;
	permissions: unknown;
	balance: unknown;
	currency_unit: unknown;
	ranking_enabled: unknown;
	voice_activity_reward: unknown;
	voice_activity_daily_cap: unknown;
}

export const load: PageServerLoad = async ({ cookies, url }) => {
	const notice = readDashboardNotice(cookies);
	const user = await getSessionUser(cookies);
	if (!user)
		return {
			user,
			guilds: [],
			selectedGuildId: null,
			botConnected: false,
			inventory: [],
			shopItems: [],
			itemMovements: [],
			dailyMemories: [],
			defaultMemoryDate: yesterday(koreanDate().date),
			notice
		};

	const db = await getDB();
	const guildRows = await db`
		SELECT ug.guild_id, ug.guild_name, ug.icon_hash, ug.permissions,
			COALESCE(a.balance, 0.00) AS balance,
			COALESCE(gs.currency_unit, 'coin') AS currency_unit,
			COALESCE(gs.ranking_enabled, TRUE) AS ranking_enabled,
			COALESCE(gs.voice_activity_reward, 0.00) AS voice_activity_reward,
			COALESCE(gs.voice_activity_daily_cap, 0.00) AS voice_activity_daily_cap
		FROM user_guilds ug
		LEFT JOIN accounts a ON a.guild_id = ug.guild_id AND a.user_id = ug.user_id
		LEFT JOIN guild_settings gs ON gs.guild_id = ug.guild_id
		WHERE ug.user_id = ${user.id}
		ORDER BY ug.guild_name
	`;
	const guilds = guildRows.map((row: GuildRow) => {
		const voiceBaseReward = Number(row.voice_activity_reward).toFixed(2);
		const voiceDailyCap = Number(row.voice_activity_daily_cap).toFixed(2);
		return {
			id: String(row.guild_id),
			name: String(row.guild_name),
			iconUrl: row.icon_hash
				? `https://cdn.discordapp.com/icons/${row.guild_id}/${row.icon_hash}.png`
				: null,
			balance: Number(row.balance).toFixed(2),
			currencyUnit: String(row.currency_unit),
			rankingEnabled: Boolean(row.ranking_enabled),
			canManage: canManageGuild(String(row.permissions)),
			voiceActivity:
				voiceBaseReward !== '0.00' && voiceDailyCap !== '0.00'
					? {
							baseReward: voiceBaseReward,
							dailyCap: voiceDailyCap,
							soloReward: calculateVoiceReward(voiceBaseReward, 1),
							twoPersonReward: calculateVoiceReward(voiceBaseReward, 2),
							threePersonReward: calculateVoiceReward(voiceBaseReward, 3),
							fourPersonReward: calculateVoiceReward(voiceBaseReward, 4),
							groupReward: calculateVoiceReward(voiceBaseReward, 5)
						}
					: null
		};
	});
	const requestedGuildId = url.searchParams.get('guild');
	const selectedGuildId = guilds.some((guild: { id: string }) => guild.id === requestedGuildId)
		? requestedGuildId
		: guilds[0]?.id || null;

	const rankingEnabled =
		selectedGuildId &&
		guilds.find((guild: { id: string }) => guild.id === selectedGuildId)?.rankingEnabled;
	const botClient = getClient();
	const botConnected = Boolean(
		selectedGuildId && botClient?.isReady() && botClient.guilds.cache.has(selectedGuildId)
	);
	const [
		ranking,
		transactions,
		attendance,
		attendanceLeaderboard,
		voiceRewardRemaining,
		inventory,
		itemMovements,
		shopItems,
		dailyMemories
	] = selectedGuildId
		? await Promise.all([
				rankingEnabled ? getBalanceRanking(selectedGuildId) : Promise.resolve([]),
				getUserTransactions(selectedGuildId, user.id),
				getAttendanceStatus(selectedGuildId, user.id),
				getAttendanceLeaderboard(selectedGuildId),
				getVoiceActivityRemaining(selectedGuildId, user.id),
				getInventory(selectedGuildId, user.id),
				getItemMovements(selectedGuildId, user.id, 10),
				listItemDefinitions(selectedGuildId),
				getAccessibleDailyMemories(selectedGuildId, user.id)
			])
		: [[], [], null, [], '0.00', [], [], [], []];
	return {
		user,
		guilds,
		selectedGuildId,
		botConnected,
		ranking,
		transactions,
		attendance,
		attendanceLeaderboard,
		voiceRewardRemaining,
		inventory,
		itemMovements,
		shopItems: shopItems.filter((item) => item.purchasePrice !== null || item.sellPrice !== null),
		dailyMemories,
		defaultMemoryDate: yesterday(koreanDate().date),
		notice
	};
};

function readDashboardNotice(cookies: Cookies) {
	const message = cookies.get(DASHBOARD_NOTICE_COOKIE) || null;
	if (message) cookies.delete(DASHBOARD_NOTICE_COOKIE, { path: '/' });
	return message;
}

function redirectToDashboard(cookies: Cookies, guildId: string, message: string): never {
	cookies.set(DASHBOARD_NOTICE_COOKIE, message, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 60
	});
	redirect(303, `/?guild=${encodeURIComponent(guildId)}`);
}

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

async function getAccessibleDailyMemories(guildId: string, userId: string) {
	const member = await getGuildMember(guildId, userId);
	return member && !member.user.bot ? getRecentDailyMemories(guildId) : [];
}

export const actions: Actions = {
	logout: async ({ cookies }) => {
		await deleteSession(cookies);
		redirect(303, '/');
	},
	addMemory: async ({ cookies, request }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const date = String(form.get('date') || '').trim();
		const content = String(form.get('content') || '').trim();
		const membership = await requireMembership(cookies, guildId);
		if (!membership) return fail(401, { message: '서버 접근 권한이 없습니다.' });
		if (!isValidMemoryDate(date, koreanDate().date))
			return fail(400, {
				message: '날짜를 YYYY-MM-DD 형식의 오늘 또는 과거 날짜로 입력해 주세요.'
			});
		if (!content || content.length > 1000)
			return fail(400, { message: '기록은 1~1,000자로 입력해 주세요.' });
		const member = await getGuildMember(guildId, membership.user.id);
		if (!member || member.user.bot)
			return fail(403, { message: '현재 Discord 서버에 참여 중인 사용자만 기록할 수 있습니다.' });
		const username = member.nick || member.user.global_name || member.user.username;
		const reward = await saveDailyMemory({
			guildId,
			userId: membership.user.id,
			username,
			entryDate: date,
			content
		});
		const unit = await getCurrencyUnit(guildId);
		redirectToDashboard(
			cookies,
			guildId,
			reward === '0.00'
				? `${date}의 서버 기록을 저장했습니다.`
				: `${date}의 서버 기록을 저장하고 ${formatMoneyDisplay(reward)} ${unit}을(를) 받았습니다.`
		);
	},
	tradeItem: async ({ cookies, request }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const itemId = String(form.get('itemId') || '');
		const direction = String(form.get('direction') || '');
		const rawQuantity = String(form.get('quantity') || '').trim();
		const membership = await requireMembership(cookies, guildId);
		if (!membership)
			return fail(401, { message: '로그인이 필요하거나 서버 접근 권한이 없습니다.' });
		if (!/^\d+$/.test(itemId) || (direction !== 'purchase' && direction !== 'sale'))
			return fail(400, { message: '올바른 상점 아이템을 선택해 주세요.' });
		if (!/^[1-9]\d{0,8}$/.test(rawQuantity))
			return fail(400, { message: '수량은 1~999,999,999 사이의 정수여야 합니다.' });
		const member = await getGuildMember(guildId, membership.user.id);
		if (!member || member.user.bot)
			return fail(403, { message: '현재 Discord 서버에 참여 중인 사용자만 거래할 수 있습니다.' });
		try {
			const result = await tradeShopItem({
				guildId,
				userId: membership.user.id,
				itemId,
				quantity: Number(rawQuantity),
				direction
			});
			const unit = await getCurrencyUnit(guildId);
			await sendTransactionNotification(
				guildId,
				`${result.item.iconEmoji} **아이템 ${direction === 'purchase' ? '구매' : '판매'}**\n사용자: <@${membership.user.id}>\n아이템: **${result.item.name} × ${result.quantity}**\n금액: **${formatMoneyDisplay(result.total)} ${unit}**\n거래 후 잔액: **${formatMoneyDisplay(result.balance)} ${unit}**`
			);
			redirectToDashboard(
				cookies,
				guildId,
				`${result.item.iconEmoji} ${result.item.name} ${result.quantity}개를 ${direction === 'purchase' ? '구매' : '판매'}했습니다. ${formatMoneyDisplay(result.total)} ${unit} · 잔액 ${formatMoneyDisplay(result.balance)} ${unit} · 보유 ${result.inventoryQuantity}개`
			);
		} catch (error) {
			if (error instanceof ItemNotFoundError)
				return fail(404, { message: '이 서버에 존재하지 않는 아이템입니다.' });
			if (error instanceof ItemNotForSaleError)
				return fail(400, { message: '현재 상점에서 거래할 수 없는 아이템입니다.' });
			if (error instanceof InsufficientBalanceError)
				return fail(409, { message: '구매에 필요한 잔액이 부족합니다.' });
			if (error instanceof InsufficientItemQuantityError)
				return fail(409, { message: '판매할 아이템 수량이 부족합니다.' });
			if (error instanceof ItemStackLimitError)
				return fail(409, { message: '구매 후 최대 보유 수량을 초과합니다.' });
			if (error instanceof ItemTradeLimitError)
				return fail(409, { message: '거래 금액 또는 거래 후 잔액이 허용 범위를 초과합니다.' });
			throw error;
		}
	},
	useItem: async ({ cookies, request }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const itemId = String(form.get('itemId') || '');
		const membership = await requireMembership(cookies, guildId);
		if (!membership)
			return fail(401, { message: '로그인이 필요하거나 서버 접근 권한이 없습니다.' });
		if (!/^\d+$/.test(itemId)) return fail(400, { message: '사용할 아이템을 선택해 주세요.' });
		const member = await getGuildMember(guildId, membership.user.id);
		if (!member || member.user.bot)
			return fail(403, { message: '현재 Discord 서버에 참여 중인 사용자만 사용할 수 있습니다.' });
		try {
			const result = await useCurrencyItem(guildId, membership.user.id, itemId);
			const unit = await getCurrencyUnit(guildId);
			await sendTransactionNotification(
				guildId,
				`${result.item.iconEmoji} **아이템 사용**\n사용자: <@${membership.user.id}>\n아이템: **${result.item.name}**\n보상: **${formatMoneyDisplay(result.reward)} ${unit}**\n사용 후 잔액: **${formatMoneyDisplay(result.balance)} ${unit}**`
			);
			redirectToDashboard(
				cookies,
				guildId,
				`${result.item.iconEmoji} ${result.item.name}을(를) 사용해 ${formatMoneyDisplay(result.reward)} ${unit}을(를) 받았습니다.`
			);
		} catch (error) {
			if (error instanceof ItemNotFoundError)
				return fail(404, { message: '이 서버에 존재하지 않는 아이템입니다.' });
			if (error instanceof ItemNotUsableError)
				return fail(400, { message: '현재 사용할 수 없는 아이템입니다.' });
			if (error instanceof InsufficientItemQuantityError)
				return fail(409, { message: '아이템을 보유하고 있지 않습니다.' });
			throw error;
		}
	},
	discardItem: async ({ cookies, request }) => {
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const itemId = String(form.get('itemId') || '');
		const membership = await requireMembership(cookies, guildId);
		if (!membership)
			return fail(401, { message: '로그인이 필요하거나 서버 접근 권한이 없습니다.' });
		if (!/^\d+$/.test(itemId)) return fail(400, { message: '버릴 아이템을 선택해 주세요.' });
		const member = await getGuildMember(guildId, membership.user.id);
		if (!member || member.user.bot)
			return fail(403, { message: '현재 Discord 서버에 참여 중인 사용자만 이용할 수 있습니다.' });
		try {
			const item = await getItemDefinition(guildId, itemId);
			const remainingQuantity = await changeInventoryQuantity({
				guildId,
				userId: membership.user.id,
				itemId,
				delta: -1,
				type: 'discard',
				referenceType: 'user_discard',
				referenceId: membership.user.id
			});
			redirectToDashboard(
				cookies,
				guildId,
				`${item.iconEmoji} ${item.name} 1개를 버렸습니다. 남은 수량: ${remainingQuantity}개`
			);
		} catch (error) {
			if (error instanceof ItemNotFoundError)
				return fail(404, { message: '이 서버에 존재하지 않는 아이템입니다.' });
			if (error instanceof InsufficientItemQuantityError)
				return fail(409, { message: '버릴 아이템을 보유하고 있지 않습니다.' });
			throw error;
		}
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
				`💸 **송금**\n보낸 사용자: <@${membership.user.id}>\n받는 사용자: <@${recipientId}>\n금액: **${formatMoneyDisplay(amount)}**`
			);
			redirectToDashboard(cookies, guildId, `${formatMoneyDisplay(amount)} 송금이 완료됐습니다.`);
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
				`📅 **출석 보상**\n사용자: <@${membership.user.id}>\n지급액: **${formatMoneyDisplay(result.reward)} ${unit}**\n지급 후 잔액: **${formatMoneyDisplay(result.balance)} ${unit}**\n연속 출석: **${result.currentStreak}일** · 최장 **${result.longestStreak}일**`
			);
			redirectToDashboard(
				cookies,
				guildId,
				`출석 완료! ${formatMoneyDisplay(result.reward)} ${unit}을(를) 받았습니다. 현재 ${result.currentStreak}일 연속, 최장 ${result.longestStreak}일입니다.`
			);
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
		publishBettingUpdate(guildId, poolId);
		await sendTransactionNotification(
			guildId,
			`🎲 **베팅 판 생성**\n#${poolId} ${title}\n판 주인: <@${membership.user.id}>`
		);
		redirectToDashboard(cookies, guildId, `#${poolId} ${title} 베팅 판을 만들었습니다.`);
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
			publishBettingUpdate(guildId, poolId);
			await sendTransactionNotification(
				guildId,
				`🎟️ **베팅 참가**\n#${poolId} ${pool?.title || ''}\n참가자: <@${membership.user.id}>\n추가 베팅: **${formatMoneyDisplay(amount)}**\n판돈: **${formatMoneyDisplay(pool?.totalAmount || amount)}**`
			);
			redirectToDashboard(
				cookies,
				guildId,
				`${formatMoneyDisplay(amount)}을 베팅했습니다. 남은 소지금: ${formatMoneyDisplay(remaining)}`
			);
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
			publishBettingUpdate(guildId, poolId);
			await sendTransactionNotification(
				guildId,
				`🏆 **베팅 정산**\n#${poolId} ${pool?.title || ''}\n승자: <@${winnerId}>\n지급액: **${formatMoneyDisplay(payout)}**\n처리자: <@${membership.user.id}>`
			);
			redirectToDashboard(
				cookies,
				guildId,
				`${pool?.winnerName || '승자'}님에게 ${formatMoneyDisplay(payout)}을 지급했습니다.`
			);
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
			publishBettingUpdate(guildId, poolId);
			await sendTransactionNotification(
				guildId,
				`↩️ **베팅 환불**\n#${poolId} ${poolBefore?.title || ''}\n${count}명에게 총 **${poolBefore?.totalAmount || '0.00'}** 환불\n처리자: <@${membership.user.id}>`
			);
			redirectToDashboard(cookies, guildId, `${count}명의 베팅액을 모두 환불했습니다.`);
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
