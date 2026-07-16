interface RealtimeTicket {
	guildId: string;
	expiresAt: number;
}

interface RealtimeState {
	tickets: Map<string, RealtimeTicket>;
	publish: ((guildId: string, poolId?: string) => void) | null;
}

const globalState = globalThis as typeof globalThis & { __mountainRealtime?: RealtimeState };
const state = (globalState.__mountainRealtime ??= { tickets: new Map(), publish: null });

export function createRealtimeTicket(guildId: string) {
	for (const [ticket, value] of state.tickets) {
		if (value.expiresAt < Date.now()) state.tickets.delete(ticket);
	}
	const ticket = crypto.randomUUID();
	state.tickets.set(ticket, { guildId, expiresAt: Date.now() + 30_000 });
	return ticket;
}

export function consumeRealtimeTicket(ticket: string) {
	const value = state.tickets.get(ticket);
	state.tickets.delete(ticket);
	if (!value || value.expiresAt < Date.now()) return null;
	return value.guildId;
}

export function registerRealtimePublisher(publish: RealtimeState['publish']) {
	state.publish = publish;
}

export function publishBettingUpdate(guildId: string, poolId?: string) {
	state.publish?.(guildId, poolId);
}
