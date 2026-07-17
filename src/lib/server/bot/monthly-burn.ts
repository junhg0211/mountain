import { sendTransactionNotification } from '$lib/server/bot/notifications';
import { runDueMonthlyBurns } from '$lib/server/db/monthly-burn';
import { formatMoneyDisplay } from '$lib/economy/money-display';

const SCAN_INTERVAL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function scan() {
	if (running) return;
	running = true;
	try {
		for (const result of await runDueMonthlyBurns()) {
			await sendTransactionNotification(
				result.guildId,
				`🔥 **Monthly burn · 월간 소각**\n대상 월: **${result.period}**\n대상 계정: **${result.accountsAffected}명**\n총 소각량: **${formatMoneyDisplay(result.totalAmount)}**`
			);
		}
	} catch (error) {
		console.error('Monthly balance burn scan failed:', error);
	} finally {
		running = false;
	}
}

export function startMonthlyBurnScheduler() {
	if (timer) return;
	void scan();
	timer = setInterval(() => void scan(), SCAN_INTERVAL_MS);
	timer.unref();
}

export function stopMonthlyBurnScheduler() {
	if (timer) clearInterval(timer);
	timer = null;
}
