import {
	completeDailyMemoryPrompt,
	getDailyMemoryPrompts,
	releaseDailyMemoryPrompt,
	reserveDailyMemoryPrompt
} from '$lib/server/db/daily-memories';

const SCAN_INTERVAL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function sendPrompt(channelId: string, entryDate: string) {
	if (!process.env.BOT_TOKEN) return false;
	const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
		method: 'POST',
		headers: {
			Authorization: `Bot ${process.env.BOT_TOKEN}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			content:
				'🌙 우리 서버의 하루를 기록해 둘 시간이에요. 날짜와 내용을 남겨 두면, 시간이 지난 뒤 이어지는 기억을 함께 꺼내 드릴게요.',
			components: [
				{
					type: 1,
					components: [
						{
							type: 2,
							style: 1,
							label: '기록하기',
							emoji: { name: '✍️' },
							custom_id: `memory:write:${entryDate}`
						},
						{
							type: 2,
							style: 2,
							label: '추억 보기',
							emoji: { name: '🗓️' },
							custom_id: `memory:view:${entryDate}`
						}
					]
				}
			],
			allowed_mentions: { parse: [] }
		})
	});
	if (!response.ok) throw new Error(`Discord memory prompt failed (${response.status}).`);
	return true;
}

async function scan() {
	if (running || !process.env.BOT_TOKEN) return;
	running = true;
	try {
		for (const prompt of await getDailyMemoryPrompts()) {
			if (!(await reserveDailyMemoryPrompt(prompt))) continue;
			try {
				await sendPrompt(prompt.channelId, prompt.entryDate);
				await completeDailyMemoryPrompt(prompt);
			} catch (error) {
				await releaseDailyMemoryPrompt(prompt);
				throw error;
			}
		}
	} catch (error) {
		console.error('Daily memory prompt scan failed:', error);
	} finally {
		running = false;
	}
}

export function startDailyMemoryScheduler() {
	if (timer) return;
	void scan();
	timer = setInterval(() => void scan(), SCAN_INTERVAL_MS);
	timer.unref();
}

export function stopDailyMemoryScheduler() {
	if (timer) clearInterval(timer);
	timer = null;
}
