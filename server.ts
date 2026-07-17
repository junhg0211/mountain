import { createServer } from 'node:http';
import { handler } from './build/handler.js';
import { startBot } from './src/lib/server/bot/index.ts';
import { consumeRealtimeTicket, publishBettingUpdate, registerRealtimePublisher } from './src/lib/server/realtime.ts';
import { WebSocketServer, WebSocket } from 'ws';
import { getDB } from './src/lib/server/db.ts';
import {
	archiveBettingPool,
	BettingOptionError,
	BettingParticipantError,
	BettingPermissionError,
	BettingPoolClosedError,
	BettingPoolNotFoundError,
	BettingWeightError,
	createTeamBettingPool,
	fundBettingPool,
	getBettingPool,
	getBettingPoolExtras,
	payDoubleBettingParticipant,
	placeBet,
	placeTeamBet,
	refundBettingParticipant,
	refundBettingPool,
	reopenBettingPool,
	settleBettingPool,
	settleTeamBettingPool,
	settleWeightedBettingPool
} from './src/lib/server/db/betting.ts';
import { getGuildMember } from './src/lib/server/discord/users.ts';
import { parseMoney } from './src/lib/server/economy/money.ts';
import { getOrCreateBalance, InsufficientBalanceError } from './src/lib/server/db/accounts.ts';
import { sendTransactionNotification } from './src/lib/server/bot/notifications.ts';
import { formatMoneyDisplay } from './src/lib/economy/money-display.ts';
import { canManageGuild } from './src/lib/server/db/user-guilds.ts';

const BET_AMOUNTS = new Set(['0.01','0.05','0.10','0.50','1.00','5.00','10.00','50.00','100.00','500.00']);

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const server = createServer(handler);
const sockets = new WebSocketServer({ noServer: true });
const guildSockets = new Map<string, Set<WebSocket>>();

void startBot().catch((error) => console.error('Discord bot startup failed:', error));

server.on('upgrade', (request, socket, head) => {
	const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
	if (url.pathname !== '/ws/betting') return socket.destroy();
	const context = consumeRealtimeTicket(url.searchParams.get('ticket') || '');
	if (!context) return socket.destroy();
	sockets.handleUpgrade(request, socket, head, (websocket) => {
		const { guildId, userId } = context;
		const clients = guildSockets.get(guildId) || new Set<WebSocket>();
		clients.add(websocket);
		guildSockets.set(guildId, clients);
		websocket.on('close', () => {
			clients.delete(websocket);
			if (!clients.size) guildSockets.delete(guildId);
		});
		websocket.send(JSON.stringify({ type: 'connected' }));
		let processing = false;
		websocket.on('message', async (raw) => {
			let requestId = '';
			try {
				const message = JSON.parse(String(raw)) as Record<string, unknown>;
				requestId = String(message.requestId || '');
				const responseType = message.type === 'dashboard-action' ? 'action-result' : message.type === 'create-pool' ? 'create-result' : 'bet-result';
				if (!['place-bet', 'dashboard-action', 'create-pool'].includes(String(message.type)) || processing) {
					websocket.send(JSON.stringify({ type: responseType, requestId, ok: false, error: processing ? '다른 작업을 처리하고 있습니다.' : '지원하지 않는 요청입니다.' }));
					return;
				}
				processing = true;
				const db = await getDB();
				const membership = await db`SELECT permissions FROM user_guilds WHERE guild_id=${guildId} AND user_id=${userId} LIMIT 1`;
				if (membership.length !== 1 || !(await getGuildMember(guildId, userId))) throw new Error('MEMBERSHIP_REQUIRED');
				if (message.type === 'create-pool') {
					const title = String(message.title || '').trim();
					if (!title || title.length > 80) throw new Error('INVALID_TITLE');
					const poolId = await createTeamBettingPool(guildId, userId, title);
					publishBettingUpdate(guildId, poolId);
					await sendTransactionNotification(guildId, `🎲 **베팅 판 생성**\n#${poolId} ${title}\n판 주인: <@${userId}>`);
					if (websocket.readyState === WebSocket.OPEN) websocket.send(JSON.stringify({ type: 'create-result', requestId, ok: true, redirect: `/bets/${poolId}?guild=${encodeURIComponent(guildId)}` }));
					return;
				}
				const poolId = String(message.poolId || '');
				if (!/^\d+$/.test(poolId)) throw new Error('INVALID_ACTION');
				const before = await getBettingPool(guildId, poolId);
				if (!before) throw new BettingPoolNotFoundError();
				if (message.type === 'place-bet') {
					const amount = parseMoney(String(message.amount || ''));
					if (!amount || !BET_AMOUNTS.has(amount)) throw new Error('INVALID_BET');
					const option = String(message.optionKey || '');
					let balance: string;
					if (before.bettingMode === 'team') {
						if (option !== 'A' && option !== 'B') throw new BettingOptionError();
						balance = await placeTeamBet(guildId, poolId, userId, option, amount);
					} else balance = await placeBet(guildId, poolId, userId, amount);
					const pool = await getBettingPool(guildId, poolId);
					const extras = await getBettingPoolExtras(guildId, poolId, userId);
					publishBettingUpdate(guildId, poolId);
					await sendTransactionNotification(guildId, `🎟️ **베팅 참가**\n#${poolId} ${pool?.title || ''}\n참가자: <@${userId}>${before.bettingMode === 'team' ? `\n선택: **${option}팀**` : ''}\n추가 베팅: **${formatMoneyDisplay(amount)}**\n판돈: **${formatMoneyDisplay(pool?.totalAmount || amount)}**`);
					if (websocket.readyState === WebSocket.OPEN) websocket.send(JSON.stringify({ type: 'bet-result', requestId, ok: true, balance, pool, ...extras }));
					return;
				}
				const result = await runDashboardAction({
					guildId,
					userId,
					permissions: String(membership[0].permissions),
					poolId,
					pool: before,
					action: String(message.action || ''),
					payload: message.payload && typeof message.payload === 'object' ? message.payload as Record<string, unknown> : {}
				});
				const pool = await getBettingPool(guildId, poolId);
				const extras = await getBettingPoolExtras(guildId, poolId, userId);
				const balance = await getOrCreateBalance(guildId, userId);
				const { notification, ...clientResult } = result;
				publishBettingUpdate(guildId, poolId);
				await sendTransactionNotification(guildId, notification);
				if (websocket.readyState === WebSocket.OPEN) websocket.send(JSON.stringify({ type: 'action-result', requestId, ok: true, balance, pool, ...extras, ...clientResult }));
			} catch (error) {
				const text = realtimeError(error);
				const type = (() => { try { const requestType = (JSON.parse(String(raw)) as Record<string, unknown>).type; return requestType === 'dashboard-action' ? 'action-result' : requestType === 'create-pool' ? 'create-result' : 'bet-result'; } catch { return 'bet-result'; } })();
				if (websocket.readyState === WebSocket.OPEN) websocket.send(JSON.stringify({ type, requestId, ok: false, error: text }));
			} finally { processing = false; }
		});
	});
});

async function runDashboardAction(context: {
	guildId: string;
	userId: string;
	permissions: string;
	poolId: string;
	pool: NonNullable<Awaited<ReturnType<typeof getBettingPool>>>;
	action: string;
	payload: Record<string, unknown>;
}) {
	const { guildId, userId, poolId, pool, action, payload } = context;
	const canManage = canManageGuild(context.permissions);
	if (action === 'settle') {
		if (pool.bettingMode === 'team') {
			const option = String(payload.winningOption || '');
			if (option !== 'A' && option !== 'B') throw new BettingOptionError();
			const result = await settleTeamBettingPool(guildId, poolId, userId, option, canManage);
			return { message: `${option}팀 승리로 비율 정산했습니다.`, notification: `🏆 **팀 베팅 정산**\n#${poolId}\n승리: **${option}팀**\n총 지급액: **${formatMoneyDisplay(result.total)}** · ${result.winnerCount}명\n처리자: <@${userId}>` };
		}
		const winnerId = String(payload.winnerId || '');
		const payout = await settleBettingPool(guildId, poolId, userId, winnerId, canManage);
		return { message: '승자에게 판돈을 지급했습니다.', notification: `🏆 **베팅 정산**\n#${poolId}\n승자: <@${winnerId}>\n지급액: **${formatMoneyDisplay(payout)}**` };
	}
	if (action === 'refund') {
		const count = await refundBettingPool(guildId, poolId, userId, canManage);
		return { message: `${count}명의 베팅을 모두 환불했습니다.`, notification: `↩️ **베팅 환불**\n#${poolId} ${pool.title}\n${count}명에게 총 **${pool.totalAmount}** 환불\n처리자: <@${userId}>` };
	}
	if (action === 'fund') {
		const amount = parseMoney(String(payload.amount || '').trim());
		if (!amount) throw new Error('INVALID_AMOUNT');
		const houseBalance = await fundBettingPool(guildId, poolId, userId, amount);
		return { message: `판 자금 ${formatMoneyDisplay(amount)}을 충전했습니다.`, notification: `🏦 **베팅 판 자금 충전**\n#${poolId}\n판 주인: <@${userId}>\n충전: **${formatMoneyDisplay(amount)}**\n판 보유금: **${formatMoneyDisplay(houseBalance)}**` };
	}
	if (action === 'refund-participant') {
		const targetId = requireUserId(payload.userId);
		const amount = await refundBettingParticipant(guildId, poolId, userId, targetId);
		return { message: '참가자의 베팅을 환불했습니다.', notification: `↩️ **개별 베팅 환불**\n#${poolId}\n대상: <@${targetId}>\n환불: **${formatMoneyDisplay(amount)}**` };
	}
	if (action === 'double-payout') {
		const targetId = requireUserId(payload.userId);
		const result = await payDoubleBettingParticipant(guildId, poolId, userId, targetId);
		return { message: '참가자에게 2배 당첨금을 지급했습니다.', notification: `🃏 **2배 당첨금 지급**\n#${poolId}\n대상: <@${targetId}>\n지급: **${formatMoneyDisplay(result.payout)}**${result.ownerCover !== '0.00' ? `\n판 주인 자동 보충: **${formatMoneyDisplay(result.ownerCover)}**` : ''}` };
	}
	if (action === 'weighted-settlement') {
		const unitAmount = parseMoney(String(payload.unitAmount || '').trim());
		if (!unitAmount) throw new Error('INVALID_AMOUNT');
		const weights: Array<{ userId: string; weight: number }> = [];
		for (const [key, value] of Object.entries(payload)) {
			if (!key.startsWith('weight_')) continue;
			const targetId = key.slice(7), rawWeight = String(value).trim();
			if (!/^\d{17,20}$/.test(targetId) || !/^-?\d{1,5}$/.test(rawWeight)) throw new BettingWeightError();
			weights.push({ userId: targetId, weight: Number(rawWeight) });
		}
		const result = await settleWeightedBettingPool(guildId, poolId, userId, unitAmount, weights);
		return { message: `가중치 정산으로 총 ${formatMoneyDisplay(result.totalTransferred)}을 이동했습니다.`, notification: `🀄 **가중치 정산**\n#${poolId}\n참가자: ${result.participantCount}명\n가중치 1당: **${formatMoneyDisplay(unitAmount)}**\n총 이동액: **${formatMoneyDisplay(result.totalTransferred)}**\n처리자: <@${userId}>` };
	}
	if (action === 'reopen') {
		await reopenBettingPool(guildId, poolId, userId, canManage);
		return { message: '같은 참가자 명단으로 새 회차를 시작했습니다.', notification: `🔄 **베팅 판 새 회차 시작**\n#${poolId}\n기존 참가자 명단을 유지하고 베팅 금액을 초기화했습니다.\n처리자: <@${userId}>` };
	}
	if (action === 'archive') {
		const refunded = await archiveBettingPool(guildId, poolId, userId);
		return { message: '베팅 판을 완전히 종료했습니다.', redirect: `/bets?guild=${encodeURIComponent(guildId)}`, notification: `⛔ **베팅 판 완전 종료**\n#${poolId}${refunded ? `\n진행 중이던 ${refunded}명의 베팅액을 환불했습니다.` : ''}\n처리자: <@${userId}>` };
	}
	throw new Error('INVALID_ACTION');
}

function requireUserId(value: unknown) {
	const userId = String(value || '');
	if (!/^\d{17,20}$/.test(userId)) throw new BettingParticipantError();
	return userId;
}

function realtimeError(error: unknown) {
	if (error instanceof InsufficientBalanceError) return '소지금이 부족합니다.';
	if (error instanceof BettingPoolClosedError) return '이미 종료된 베팅 판입니다.';
	if (error instanceof BettingPoolNotFoundError) return '베팅 판을 찾을 수 없습니다.';
	if (error instanceof BettingPermissionError) return '이 작업을 처리할 권한이 없습니다.';
	if (error instanceof BettingParticipantError) return '처리할 참가자를 올바르게 선택해 주세요.';
	if (error instanceof BettingWeightError) return '서로 다른 가중치를 입력해 0.01 이상 정산되도록 해 주세요.';
	if (error instanceof BettingOptionError) return 'A팀 또는 B팀을 선택해 주세요. 기존 회차에서 선택한 팀은 바꿀 수 없습니다.';
	if (error instanceof Error && error.message === 'MEMBERSHIP_REQUIRED') return '서버 접근 권한이 없습니다.';
	if (error instanceof Error && error.message === 'INVALID_AMOUNT') return '0.01 이상의 올바른 금액을 입력해 주세요.';
	if (error instanceof Error && error.message === 'INVALID_TITLE') return '베팅 판 제목은 1~80자로 입력해 주세요.';
	return '베팅 작업을 처리하지 못했습니다.';
}

registerRealtimePublisher((guildId, poolId) => {
	const message = JSON.stringify({ type: 'betting-update', poolId: poolId || null });
	for (const socket of guildSockets.get(guildId) || []) {
		if (socket.readyState === WebSocket.OPEN) socket.send(message);
	}
});

server.listen(port, host, () => console.log(`Mountain listening on http://${host}:${port}`));

function closeRealtimeServer() {
	registerRealtimePublisher(null);
	for (const clients of guildSockets.values()) for (const socket of clients) socket.close(1001);
	sockets.close();
	server.close();
}

process.once('SIGINT', closeRealtimeServer);
process.once('SIGTERM', closeRealtimeServer);
