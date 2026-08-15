import { createServer } from 'node:http';
import { handler } from './build/handler.js';
import { getClient, startBot } from './src/lib/server/bot/index.ts';
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
import {
	addGuildMemberRole,
	getGuildMember,
	removeGuildMemberRole
} from './src/lib/server/discord/users.ts';
import { parseMoney } from './src/lib/server/economy/money.ts';
import { getOrCreateBalance, InsufficientBalanceError } from './src/lib/server/db/accounts.ts';
import { sendTransactionNotification } from './src/lib/server/bot/notifications.ts';
import { formatMoneyDisplay } from './src/lib/economy/money-display.ts';
import { canManageGuild } from './src/lib/server/db/user-guilds.ts';
import {
	BasecampError,
	configureBasecamp,
	createBasecampWall,
	createBasecampRoom,
	deleteBasecampWall,
	deleteBasecampRoom,
	getBasecampState,
	updateBasecampRoom
} from './src/lib/server/basecamp.ts';

const BET_AMOUNTS = new Set(['0.01','0.05','0.10','0.50','1.00','5.00','10.00','50.00','100.00','500.00']);

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const server = createServer(handler);
const sockets = new WebSocketServer({ noServer: true });
const guildSockets = new Map<string, Set<WebSocket>>();
const basecampSockets = new Map<string, Set<WebSocket>>();
interface BasecampPresence {
	id: string;
	userId: string;
	username: string;
	avatarUrl: string | null;
	x: number;
	y: number;
}
const basecampPresences = new Map<string, Map<WebSocket, BasecampPresence>>();
const basecampSocketRoles = new Map<WebSocket, string | null>();
const basecampRoleRemovalTimers = new Map<string, ReturnType<typeof setTimeout>>();
const basecampWorldStates = new Map<string, Awaited<ReturnType<typeof getBasecampState>>>();
const basecampAutoMoves = new Map<WebSocket, boolean>();
const basecampVoiceTargets = new Map<WebSocket, string | null>();
const basecampVoiceMoveTimers = new Map<WebSocket, ReturnType<typeof setTimeout>>();
const basecampVoiceMoveAttempts = new Map<WebSocket, number>();
const basecampVoiceMoveQueues = new Map<WebSocket, Promise<void>>();

void startBot().catch((error) => console.error('Discord bot startup failed:', error));

server.on('upgrade', (request, socket, head) => {
	const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
	if (url.pathname !== '/ws/betting' && url.pathname !== '/ws/basecamp') return socket.destroy();
	const context = consumeRealtimeTicket(url.searchParams.get('ticket') || '');
	if (!context) return socket.destroy();
	if (url.pathname === '/ws/basecamp') {
		sockets.handleUpgrade(request, socket, head, (websocket) => {
			void attachBasecampSocket(websocket, context).catch((error) => {
				console.error('Basecamp socket initialization failed:', error);
				websocket.close(1011, 'Basecamp initialization failed');
			});
		});
		return;
	}
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

async function attachBasecampSocket(
	websocket: WebSocket,
	context: { guildId: string; userId: string }
) {
	const { guildId, userId } = context;
	const member = await getGuildMember(guildId, userId);
	if (!member) {
		websocket.close(1008, 'Guild membership required');
		return;
	}
	const presence: BasecampPresence = {
		id: crypto.randomUUID(),
		userId,
		username: member.nick || member.user.global_name || member.user.username,
		avatarUrl: member.user.avatar
			? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.webp?size=80`
			: null,
		x: 20,
		y: 15
	};
	const initialState = await getBasecampState(guildId);
	basecampWorldStates.set(guildId, initialState);
	const clients = basecampSockets.get(guildId) || new Set<WebSocket>();
	clients.add(websocket);
	basecampSockets.set(guildId, clients);
	const presences = basecampPresences.get(guildId) || new Map<WebSocket, BasecampPresence>();
	presences.set(websocket, presence);
	basecampPresences.set(guildId, presences);
	basecampSocketRoles.set(websocket, initialState.settings.accessRoleId);
	basecampAutoMoves.set(websocket, false);
	basecampVoiceTargets.set(websocket, getBasecampVoiceTarget(initialState, presence));
	if (initialState.settings.accessRoleId)
		void grantBasecampRole(guildId, userId, initialState.settings.accessRoleId);
	websocket.on('close', () => {
		clients.delete(websocket);
		if (!clients.size) basecampSockets.delete(guildId);
		presences.delete(websocket);
		if (!presences.size) basecampPresences.delete(guildId);
		const roleId = basecampSocketRoles.get(websocket);
		basecampSocketRoles.delete(websocket);
		basecampAutoMoves.delete(websocket);
		basecampVoiceTargets.delete(websocket);
		clearBasecampVoiceMoveTimer(websocket);
		basecampVoiceMoveAttempts.delete(websocket);
		basecampVoiceMoveQueues.delete(websocket);
		if (!clients.size) basecampWorldStates.delete(guildId);
		if (roleId) scheduleBasecampRoleRemoval(guildId, userId, roleId);
		broadcastBasecampPresences(guildId);
	});
	websocket.send(JSON.stringify({ type: 'basecamp-connected', presenceId: presence.id }));
	websocket.send(JSON.stringify({ type: 'basecamp-state', ...initialState }));
	broadcastBasecampPresences(guildId);

	let processing = false;
	let lastMoveAt = 0;
	websocket.on('message', async (raw) => {
		let requestId = '';
		try {
			const message = JSON.parse(String(raw)) as Record<string, unknown>;
			requestId = String(message.requestId || '');
			const type = String(message.type || '');
			if (
				!['basecamp-ping', 'basecamp-sync', 'basecamp-move', 'basecamp-auto-move', 'basecamp-configure', 'basecamp-create-room', 'basecamp-update-room', 'basecamp-delete-room', 'basecamp-create-wall', 'basecamp-delete-wall'].includes(
					type
				)
			)
				throw new BasecampError('지원하지 않는 Basecamp 요청입니다.');
			if (type === 'basecamp-ping') {
				const target = basecampVoiceTargets.get(websocket);
				if (basecampAutoMoves.get(websocket) && target && !basecampVoiceMoveTimers.has(websocket))
					queueBasecampVoiceMove(websocket, guildId, userId, target);
				websocket.send(JSON.stringify({ type: 'basecamp-pong' }));
				return;
			}
			if (type === 'basecamp-move') {
				const now = Date.now();
				if (now - lastMoveAt < 30) return;
				lastMoveAt = now;
				const x = Number(message.x);
				const y = Number(message.y);
				if (!Number.isFinite(x) || !Number.isFinite(y))
					throw new BasecampError('올바르지 않은 이동 좌표입니다.');
				const nextX = Math.max(0.6, Math.min(39.4, x));
				const nextY = Math.max(0.8, Math.min(23.2, y));
				const state = basecampWorldStates.get(guildId);
				if (
					state && (
						basecampWallBlocksMovement(presence.x, presence.y, nextX, presence.y, state.walls) ||
						basecampWallBlocksMovement(nextX, presence.y, nextX, nextY, state.walls)
					)
				) return;
				presence.x = nextX;
				presence.y = nextY;
				broadcastBasecampPresences(guildId);
				if (state) updateBasecampVoiceTarget(websocket, guildId, presence, state);
				return;
			}
			if (type === 'basecamp-auto-move') {
				const enabled = message.enabled === true;
				basecampAutoMoves.set(websocket, enabled);
				if (!enabled) clearBasecampVoiceMoveTimer(websocket);
				const state = basecampWorldStates.get(guildId);
				if (enabled && state) {
					const target = getBasecampVoiceTarget(state, presence);
					basecampVoiceTargets.set(websocket, target);
					if (target) queueBasecampVoiceMove(websocket, guildId, userId, target);
				}
				websocket.send(JSON.stringify({ type: 'basecamp-auto-move-result', enabled }));
				return;
			}
			if (processing) throw new BasecampError('다른 공간 작업을 처리하고 있습니다.');
			if (type === 'basecamp-sync') {
				websocket.send(
					JSON.stringify({ type: 'basecamp-state', ...(await getBasecampState(guildId)) })
				);
				return;
			}

			processing = true;
			let state: Awaited<ReturnType<typeof getBasecampState>>;
			let messageText: string;
			if (type === 'basecamp-configure') {
				state = await configureBasecamp({
					guildId,
					userId,
					categoryId: String(message.categoryId || ''),
					accessRoleId: String(message.accessRoleId || '')
				});
				await syncBasecampRoles(guildId, state.settings.accessRoleId);
				messageText = '월드 광장 채널과 Discord 연결 설정을 저장했습니다.';
			} else if (type === 'basecamp-create-room') {
				state = await createBasecampRoom({
					guildId,
					userId,
					name: String(message.name || ''),
					x: Number(message.x),
					y: Number(message.y),
					width: Number(message.width),
					height: Number(message.height)
				});
				messageText = `${String(message.name || '').trim()} 방과 Discord 음성 채널을 만들었습니다.`;
			} else if (type === 'basecamp-update-room') {
				state = await updateBasecampRoom({
					guildId,
					userId,
					id: String(message.id || ''),
					name: String(message.name || ''),
					x: Number(message.x),
					y: Number(message.y),
					width: Number(message.width),
					height: Number(message.height)
				});
				messageText = `${String(message.name || '').trim()} 방과 음성 채널을 수정했습니다.`;
			} else if (type === 'basecamp-delete-room') {
				state = await deleteBasecampRoom({
					guildId,
					userId,
					id: String(message.id || '')
				});
				messageText = '방과 Discord 음성 채널을 삭제했습니다.';
			} else if (type === 'basecamp-create-wall') {
				state = await createBasecampWall({
					guildId,
					userId,
					x: Number(message.x),
					y: Number(message.y),
					width: Number(message.width),
					height: Number(message.height),
					orientation: String(message.orientation || '')
				});
				messageText = '벽을 만들었습니다.';
			} else {
				state = await deleteBasecampWall({ guildId, userId, id: String(message.id || '') });
				messageText = '벽을 삭제했습니다.';
			}
			websocket.send(
				JSON.stringify({ type: 'basecamp-result', requestId, ok: true, message: messageText })
			);
			broadcastBasecampState(guildId, state);
		} catch (error) {
			console.error('Basecamp realtime request failed:', error);
			if (websocket.readyState === WebSocket.OPEN)
				websocket.send(
					JSON.stringify({
						type: 'basecamp-result',
						requestId,
						ok: false,
						error:
							error instanceof BasecampError
								? error.message
								: 'Basecamp 작업을 처리하지 못했습니다.'
					})
				);
		} finally {
			processing = false;
		}
	});
}

function basecampRoleKey(guildId: string, userId: string, roleId: string) {
	return `${guildId}:${userId}:${roleId}`;
}

async function grantBasecampRole(guildId: string, userId: string, roleId: string) {
	const key = basecampRoleKey(guildId, userId, roleId);
	const timer = basecampRoleRemovalTimers.get(key);
	if (timer) clearTimeout(timer);
	basecampRoleRemovalTimers.delete(key);
	try {
		await addGuildMemberRole(guildId, userId, roleId);
	} catch (error) {
		console.error(`Basecamp role assignment failed for ${guildId}/${userId}:`, error);
	}
}

function scheduleBasecampRoleRemoval(guildId: string, userId: string, roleId: string) {
	const key = basecampRoleKey(guildId, userId, roleId);
	const previous = basecampRoleRemovalTimers.get(key);
	if (previous) clearTimeout(previous);
	basecampRoleRemovalTimers.set(
		key,
		setTimeout(() => {
			basecampRoleRemovalTimers.delete(key);
			const stillConnected = [...(basecampPresences.get(guildId)?.entries() || [])].some(
				([socket, connected]) =>
					connected.userId === userId && basecampSocketRoles.get(socket) === roleId
			);
			if (!stillConnected)
				void removeGuildMemberRole(guildId, userId, roleId).catch((error) =>
					console.error(`Basecamp role removal failed for ${guildId}/${userId}:`, error)
				);
		}, 10_000)
	);
}

async function syncBasecampRoles(guildId: string, roleId: string | null) {
	const presences = basecampPresences.get(guildId);
	if (!presences) return;
	await Promise.all(
		[...presences.entries()].map(async ([socket, presence]) => {
			const previousRoleId = basecampSocketRoles.get(socket);
			if (previousRoleId === roleId) return;
			basecampSocketRoles.set(socket, roleId);
			if (previousRoleId)
				await removeGuildMemberRole(guildId, presence.userId, previousRoleId).catch((error) =>
					console.error(`Old Basecamp role removal failed for ${guildId}/${presence.userId}:`, error)
				);
			if (roleId) await grantBasecampRole(guildId, presence.userId, roleId);
		})
	);
}

function broadcastBasecampPresences(guildId: string) {
	const message = JSON.stringify({
		type: 'basecamp-presences',
		presences: [...(basecampPresences.get(guildId)?.values() || [])]
	});
	for (const socket of basecampSockets.get(guildId) || []) {
		if (socket.readyState === WebSocket.OPEN) socket.send(message);
	}
}

function broadcastBasecampState(
	guildId: string,
	state: Awaited<ReturnType<typeof getBasecampState>>
) {
	basecampWorldStates.set(guildId, state);
	const message = JSON.stringify({ type: 'basecamp-state', ...state });
	for (const socket of basecampSockets.get(guildId) || []) {
		if (socket.readyState !== WebSocket.OPEN) continue;
		socket.send(message);
		const presence = basecampPresences.get(guildId)?.get(socket);
		if (presence) updateBasecampVoiceTarget(socket, guildId, presence, state);
	}
}

function getBasecampVoiceTarget(
	state: Awaited<ReturnType<typeof getBasecampState>>,
	presence: BasecampPresence
) {
	const room = state.rooms.find(
		(item) =>
			item.status === 'active' &&
			presence.x >= item.x &&
			presence.x < item.x + item.width &&
			presence.y >= item.y &&
			presence.y < item.y + item.height
	);
	return room?.voiceChannelId || state.settings.lobbyChannelId;
}

function basecampWallBlocksMovement(
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
	walls: Array<{ x: number; y: number; width: number; height: number; orientation: string }>
) {
	const radius = 0.32;
	return walls.some((wall) => {
		const horizontal = wall.orientation === 'horizontal';
		if (horizontal) {
			const line = wall.y;
			const overlaps = toX + radius > wall.x && toX - radius < wall.x + wall.width;
			if (!overlaps || Math.abs(fromY - line) < radius) return false;
			return toY > fromY
				? fromY + radius <= line && toY + radius > line
				: fromY - radius >= line && toY - radius < line;
		}
		const line = wall.x;
		const overlaps = toY + radius > wall.y && toY - radius < wall.y + wall.height;
		if (!overlaps || Math.abs(fromX - line) < radius) return false;
		return toX > fromX
			? fromX + radius <= line && toX + radius > line
			: fromX - radius >= line && toX - radius < line;
	});
}

function updateBasecampVoiceTarget(
	websocket: WebSocket,
	guildId: string,
	presence: BasecampPresence,
	state: Awaited<ReturnType<typeof getBasecampState>>
) {
	const target = getBasecampVoiceTarget(state, presence);
	const changed = basecampVoiceTargets.get(websocket) !== target;
	basecampVoiceTargets.set(websocket, target);
	if (!basecampAutoMoves.get(websocket) || !target) {
		clearBasecampVoiceMoveTimer(websocket);
		return;
	}
	if (changed) {
		scheduleBasecampVoiceMove(websocket, guildId, presence.userId, target);
		return;
	}
	const lastAttempt = basecampVoiceMoveAttempts.get(websocket) || 0;
	if (!basecampVoiceMoveTimers.has(websocket) && Date.now() - lastAttempt >= 2_000)
		queueBasecampVoiceMove(websocket, guildId, presence.userId, target);
}

function scheduleBasecampVoiceMove(
	websocket: WebSocket,
	guildId: string,
	userId: string,
	channelId: string
) {
	clearBasecampVoiceMoveTimer(websocket);
	basecampVoiceMoveTimers.set(
		websocket,
		setTimeout(() => {
			basecampVoiceMoveTimers.delete(websocket);
			if (
				websocket.readyState === WebSocket.OPEN &&
				basecampAutoMoves.get(websocket) &&
				basecampVoiceTargets.get(websocket) === channelId
			)
				queueBasecampVoiceMove(websocket, guildId, userId, channelId);
		}, 300)
	);
}

function clearBasecampVoiceMoveTimer(websocket: WebSocket) {
	const timer = basecampVoiceMoveTimers.get(websocket);
	if (timer) clearTimeout(timer);
	basecampVoiceMoveTimers.delete(websocket);
}

function queueBasecampVoiceMove(
	websocket: WebSocket,
	guildId: string,
	userId: string,
	channelId: string
) {
	basecampVoiceMoveAttempts.set(websocket, Date.now());
	const previous = basecampVoiceMoveQueues.get(websocket) || Promise.resolve();
	const next = previous
		.catch(() => undefined)
		.then(async () => {
			if (!basecampAutoMoves.get(websocket) || basecampVoiceTargets.get(websocket) !== channelId)
				return;
			const client = getClient();
			if (!client?.isReady()) throw new Error('Discord 봇이 아직 준비되지 않았습니다.');
			const guild = await client.guilds.fetch(guildId);
			const member = await guild.members.fetch(userId);
			if (!member.voice.channelId) {
				websocket.send(
					JSON.stringify({
						type: 'basecamp-voice-status',
						ok: false,
						message: '먼저 월드 광장 음성 채널에 참가해 주세요.'
					})
				);
				return;
			}
			if (member.voice.channelId === channelId) return;
			await member.voice.setChannel(channelId, 'Basecamp room transition');
			if (websocket.readyState === WebSocket.OPEN)
				websocket.send(
					JSON.stringify({
						type: 'basecamp-voice-status',
						ok: true,
						message: '현재 공간의 음성 채널로 이동했습니다.'
					})
				);
		})
		.catch((error) => {
			console.error(`Basecamp voice move failed for ${guildId}/${userId}:`, error);
			if (websocket.readyState === WebSocket.OPEN)
				websocket.send(
					JSON.stringify({
						type: 'basecamp-voice-status',
						ok: false,
						message: '음성 채널을 이동하지 못했습니다. 봇의 멤버 이동 권한을 확인해 주세요.'
					})
				);
		});
	basecampVoiceMoveQueues.set(websocket, next);
}

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
	for (const clients of basecampSockets.values()) for (const socket of clients) socket.close(1001);
	sockets.close();
	server.close();
}

process.once('SIGINT', closeRealtimeServer);
process.once('SIGTERM', closeRealtimeServer);
