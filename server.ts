import { createServer } from 'node:http';
import { handler } from './build/handler.js';
import { startBot } from './src/lib/server/bot/index.ts';
import { consumeRealtimeTicket, registerRealtimePublisher } from './src/lib/server/realtime.ts';
import { WebSocketServer, WebSocket } from 'ws';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const server = createServer(handler);
const sockets = new WebSocketServer({ noServer: true });
const guildSockets = new Map<string, Set<WebSocket>>();

void startBot().catch((error) => console.error('Discord bot startup failed:', error));

server.on('upgrade', (request, socket, head) => {
	const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
	if (url.pathname !== '/ws/betting') return socket.destroy();
	const guildId = consumeRealtimeTicket(url.searchParams.get('ticket') || '');
	if (!guildId) return socket.destroy();
	sockets.handleUpgrade(request, socket, head, (websocket) => {
		const clients = guildSockets.get(guildId) || new Set<WebSocket>();
		clients.add(websocket);
		guildSockets.set(guildId, clients);
		websocket.on('close', () => {
			clients.delete(websocket);
			if (!clients.size) guildSockets.delete(guildId);
		});
		websocket.send(JSON.stringify({ type: 'connected' }));
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
