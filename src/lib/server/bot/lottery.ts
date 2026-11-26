import type { Client } from 'discord.js';
import { createHash } from 'node:crypto';
import { getDB } from '$lib/server/db';
import { getNotificationChannel, getCurrencyUnit } from '$lib/server/db/guild-settings';
import { sendTransactionNotification } from './notifications';
import {
	auditLotteryFund,
	drawDueLottery,
	getLotteryResult,
	initializeLottery,
	settleLottery,
	winningNumbers,
	LotteryIntegrityError
} from '$lib/server/db/lottery';
import { moneyToCents } from '$lib/server/economy/money';
import { lotteryNumber, LOTTERY_WEIGHTS } from '$lib/server/economy/lottery';

type Result = NonNullable<Awaited<ReturnType<typeof getLotteryResult>>>;
function theoreticalMoney(numeratorCents: bigint, denominator: bigint): string {
	const divisor = denominator * 100n;
	const scaled = (numeratorCents * 1000000n) / divisor;
	const fraction = String(scaled % 1000000n)
		.padStart(6, '0')
		.replace(/0+$/, '');
	const approximate = (numeratorCents * 1000000n) % divisor !== 0n;
	return `${approximate ? '약 ' : ''}${scaled / 1000000n}${fraction ? `.${fraction}` : ''}`;
}

export function formatLotteryResult(result: Result, unit: string, includeWinners = false): string {
	const r = result.round;
	const drawn = winningNumbers(r);
	const lines = [`🎟️ 제${r.round_number}회 토쿤 복권 추첨 결과`];
	for (let rank = 1; rank <= 3; rank++) {
		const numbers =
			rank === 1 ? drawn.slice(0, 2) : rank === 2 ? drawn.slice(2, 7) : drawn.slice(7);
		const count = Number(result.counts.find((c) => Number(c.rank_number) === rank)?.count ?? 0);
		// Extra display precision is informational; paid amounts remain per-user integer cents.
		const numerator = moneyToCents(String(r.fund_before)) * 60n * BigInt(LOTTERY_WEIGHTS[rank - 1]);
		const denominator = 100n * BigInt(r.total_weight);
		const theoretical =
			denominator > 0n
				? `${theoreticalMoney(numerator, denominator)} ${unit} (이론상)`
				: '당첨 복권 없음';
		lines.push(
			`${rank}등: ${numbers.map(lotteryNumber).join(', ')}\n당첨 ${count}장 · 장당 ${theoretical}`
		);
	}
	lines.push(
		`판매 복권: ${moneyToCents(String(r.sales)) / 100n}장\n전체 복권기금: ${r.fund_before} ${unit}`
	);
	if (includeWinners) {
		lines.push('🏆 당첨자');
		for (const p of result.payouts) {
			const ranks = result.winners
				.filter((w) => w.user_id === p.user_id)
				.map((w) => `${w.rank_number}등 ${w.count}장`)
				.join(', ');
			lines.push(`<@${p.user_id}> — ${ranks} — ${p.amount} ${unit}`);
		}
	}
	if (!result.payouts.length) lines.push('당첨자가 없습니다.');
	lines.push(
		`당첨금 지급: ${r.paid} ${unit}\n영구 소각: ${r.burned} ${unit}\n차회 이월: ${r.carry_out} ${unit}`
	);
	return lines.join('\n\n');
}

export function splitLotteryMessage(content: string): string[] {
	const chunks: string[] = [];
	let chunk = '';
	for (const line of content.split('\n')) {
		if ((chunk + '\n' + line).length > 1900) {
			chunks.push(chunk);
			chunk = '';
		}
		chunk += (chunk ? '\n' : '') + line;
	}
	if (chunk) chunks.push(chunk);
	return chunks;
}

const alertTimes = new Map<string, number>();
export async function alertLotteryIntegrity(guildId: string, error: unknown) {
	console.error(`Lottery integrity error in guild ${guildId}:`, error);
	if (Date.now() - (alertTimes.get(guildId) ?? 0) < 3600000) return;
	alertTimes.set(guildId, Date.now());
	await sendTransactionNotification(
		guildId,
		'⚠️ 복권기금 불일치: 복권 거래가 중단되었습니다. 관리자는 봇 잔액과 복권기금 기록을 확인해 주세요.'
	).catch(console.error);
}

async function queueAnnouncements(guild: string) {
	const db = await getDB();
	const rows =
		await db`SELECT round_number FROM lottery_rounds r WHERE guild_id=${guild} AND status='settled' AND NOT EXISTS (SELECT 1 FROM lottery_announcements a WHERE a.guild_id=r.guild_id AND a.round_number=r.round_number)`;
	for (const row of rows) {
		const round = Number(row.round_number);
		const result = await getLotteryResult(guild, round);
		if (!result) continue;
		const chunks = splitLotteryMessage(
			formatLotteryResult(result, await getCurrencyUnit(guild), true)
		);
		await db.begin(async (tx) => {
			for (const [index, content] of chunks.entries()) {
				const nonce = createHash('sha256')
					.update(`${guild}:${round}:${index}`)
					.digest('hex')
					.slice(0, 24);
				await tx`INSERT IGNORE INTO lottery_announcements (guild_id, round_number, chunk_index, content, nonce) VALUES (${guild}, ${round}, ${index}, ${content}, ${nonce})`;
			}
		});
	}
	const channel = await getNotificationChannel(guild);
	if (!channel || !process.env.BOT_TOKEN) return;
	const pending =
		await db`SELECT * FROM lottery_announcements WHERE guild_id=${guild} AND sent_at IS NULL ORDER BY round_number, chunk_index`;
	for (const row of pending) {
		const now = Date.now();
		const claimed =
			await db`UPDATE lottery_announcements SET reserved_at=${now} WHERE guild_id=${guild} AND round_number=${row.round_number} AND chunk_index=${row.chunk_index} AND sent_at IS NULL AND (reserved_at IS NULL OR reserved_at < ${now - 300000})`;
		if (!claimed.affectedRows) break;
		try {
			const response = await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
				method: 'POST',
				headers: {
					Authorization: `Bot ${process.env.BOT_TOKEN}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					content: row.content,
					nonce: row.nonce,
					enforce_nonce: true,
					allowed_mentions: { parse: [] }
				})
			});
			if (!response.ok) throw new Error(`Lottery announcement failed (${response.status})`);
			await db`UPDATE lottery_announcements SET sent_at=CURRENT_TIMESTAMP WHERE guild_id=${guild} AND round_number=${row.round_number} AND chunk_index=${row.chunk_index}`;
		} catch (error) {
			console.error('Lottery announcement delivery failed:', error);
			// Preserve ordering and retry independently from the already committed settlement.
			break;
		}
	}
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
export async function scanLotteries(client: Client) {
	if (running || !client.isReady()) return;
	running = true;
	try {
		for (const guild of client.guilds.cache.values()) {
			try {
				await initializeLottery(guild.id, client.user.id);
				await auditLotteryFund(guild.id);
				// Bound each scan while still catching up missed weekly rounds in order.
				for (let i = 0; i < 52; i++) {
					const round = await drawDueLottery(guild.id);
					if (round === null) break;
					await settleLottery(guild.id, round);
				}
				await queueAnnouncements(guild.id);
			} catch (error) {
				if (error instanceof LotteryIntegrityError) await alertLotteryIntegrity(guild.id, error);
				else console.error(`Lottery scan failed for ${guild.id}:`, error);
			}
		}
	} finally {
		running = false;
	}
}
export function startLotteryScheduler(client: Client) {
	if (timer) return;
	void scanLotteries(client);
	timer = setInterval(() => void scanLotteries(client), 15000);
	timer.unref();
}
export function stopLotteryScheduler() {
	if (timer) clearInterval(timer);
	timer = null;
}
