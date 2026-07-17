import { createServer } from 'node:http';
import { handler } from './build/handler.js';
import { startBot } from './src/lib/server/bot/index.ts';
import { consumeRealtimeTicket, publishBettingUpdate, registerRealtimePublisher } from './src/lib/server/realtime.ts';
import { WebSocketServer, WebSocket } from 'ws';
import { getDB } from './src/lib/server/db.ts';
import { getBettingPool, getBettingPoolExtras, placeBet, placeTeamBet, BettingOptionError, BettingPoolClosedError, BettingPoolNotFoundError } from './src/lib/server/db/betting.ts';
import { getGuildMember } from './src/lib/server/discord/users.ts';
import { parseMoney } from './src/lib/server/economy/money.ts';
import { InsufficientBalanceError } from './src/lib/server/db/accounts.ts';
import { sendTransactionNotification } from './src/lib/server/bot/notifications.ts';
import { formatMoneyDisplay } from './src/lib/economy/money-display.ts';

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
				if (message.type !== 'place-bet' || processing) {
					websocket.send(JSON.stringify({ type: 'bet-result', requestId, ok: false, error: processing ? '다른 베팅을 처리하고 있습니다.' : '지원하지 않는 요청입니다.' }));
					return;
				}
				processing = true;
				const poolId = String(message.poolId || ''), amount = parseMoney(String(message.amount || ''));
				if (!/^\d+$/.test(poolId) || !amount || !BET_AMOUNTS.has(amount)) throw new Error('INVALID_BET');
				const db = await getDB();
				const membership = await db`SELECT 1 FROM user_guilds WHERE guild_id=${guildId} AND user_id=${userId} LIMIT 1`;
				if (membership.length !== 1 || !(await getGuildMember(guildId, userId))) throw new Error('MEMBERSHIP_REQUIRED');
				const before = await getBettingPool(guildId, poolId);
				if (!before) throw new BettingPoolNotFoundError();
				const option = String(message.optionKey || '');
				let balance: string;
				if (before.bettingMode === 'team') {
					if (option !== 'A' && option !== 'B') throw new BettingOptionError();
					balance = await placeTeamBet(guildId, poolId, userId, option, amount);
				} else balance = await placeBet(guildId, poolId, userId, amount);
				const pool = await getBettingPool(guildId, poolId);
				const extras = await getBettingPoolExtras(guildId, poolId, userId);
				websocket.send(JSON.stringify({ type: 'bet-result', requestId, ok: true, balance, pool, ...extras }));
				publishBettingUpdate(guildId, poolId);
				await sendTransactionNotification(guildId, `🎟️ **베팅 참가**\n#${poolId} ${pool?.title || ''}\n참가자: <@${userId}>${before.bettingMode === 'team' ? `\n선택: **${option}팀**` : ''}\n추가 베팅: **${formatMoneyDisplay(amount)}**\n판돈: **${formatMoneyDisplay(pool?.totalAmount || amount)}**`);
			} catch (error) {
				const text = error instanceof InsufficientBalanceError ? '베팅할 소지금이 부족합니다.' : error instanceof BettingPoolClosedError ? '이미 종료된 베팅 판입니다.' : error instanceof BettingPoolNotFoundError ? '베팅 판을 찾을 수 없습니다.' : error instanceof BettingOptionError ? 'A팀 또는 B팀을 선택해 주세요. 기존 회차에서 선택한 팀은 바꿀 수 없습니다.' : error instanceof Error && error.message === 'MEMBERSHIP_REQUIRED' ? '서버 접근 권한이 없습니다.' : '베팅을 처리하지 못했습니다.';
				if (websocket.readyState === WebSocket.OPEN) websocket.send(JSON.stringify({ type: 'bet-result', requestId, ok: false, error: text }));
			} finally { processing = false; }
		});
	});
});

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
