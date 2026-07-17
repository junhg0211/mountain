import { processDueRoleSubscriptions, processDueScheduledTransfers } from '$lib/server/db/automatic-payments';
import { sendTransactionNotification } from './notifications';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick() {
	if (running) return;
	running = true;
	try {
		const subscriptions = await processDueRoleSubscriptions();
		for (const item of subscriptions) await sendTransactionNotification(item.guildId, `🎨 **역할 구독 갱신**\n사용자: <@${item.userId}>\n금액: **${item.amount}**`);
		const transfers = await processDueScheduledTransfers();
		for (const item of transfers) await sendTransactionNotification(item.guildId, `🔁 **자동 송금**\n보낸 사용자: <@${item.senderId}>\n받는 사용자: <@${item.recipientId}>\n금액: **${item.amount}**`);
	} catch (error) {
		console.error('Automatic payment scheduler failed:', error);
	} finally {
		running = false;
	}
}

export function startAutomaticPaymentScheduler() {
	if (timer) return;
	void tick();
	timer = setInterval(() => void tick(), 60_000);
	timer.unref();
}

export function stopAutomaticPaymentScheduler() {
	if (timer) clearInterval(timer);
	timer = null;
}
