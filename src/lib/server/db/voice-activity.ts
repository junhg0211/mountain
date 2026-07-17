import { getDB } from '$lib/server/db';
import { centsToMoney, moneyToCents } from '$lib/server/economy/money';

const INTERVAL_MS = 5 * 60 * 1000;

function koreanDate(now: Date) {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Seoul',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(now);
}

export function voiceRewardBucket(now = new Date()) {
	return Math.floor(now.getTime() / INTERVAL_MS);
}

export function calculateVoiceReward(baseReward: string, participantCount: number) {
	const base = moneyToCents(baseReward);
	if (participantCount < 1 || base <= 0n) return '0.00';
	if (participantCount === 1) return centsToMoney(base * 3n);
	if (participantCount === 2) return centsToMoney(base * 2n);
	if (participantCount === 3) return centsToMoney((base * 3n) / 2n);
	if (participantCount === 4) return centsToMoney((base * 5n) / 4n);
	return centsToMoney(base);
}

export async function awardVoiceActivity(input: {
	guildId: string;
	userId: string;
	channelId: string;
	participantCount: number;
	baseReward: string;
	dailyCap: string;
	now?: Date;
}) {
	const desired = moneyToCents(calculateVoiceReward(input.baseReward, input.participantCount));
	const cap = moneyToCents(input.dailyCap);
	if (desired <= 0n || cap <= 0n) return null;
	const now = input.now || new Date();
	const bucket = voiceRewardBucket(now);
	const rewardDate = koreanDate(now);
	const db = await getDB();
	return db.begin(async (tx) => {
		await tx`
			INSERT IGNORE INTO accounts (guild_id, user_id)
			VALUES (${input.guildId}, ${input.userId})
		`;
		await tx`
			SELECT balance FROM accounts
			WHERE guild_id=${input.guildId} AND user_id=${input.userId} FOR UPDATE
		`;
		const duplicate = await tx`
			SELECT 1 FROM voice_activity_rewards
			WHERE guild_id=${input.guildId} AND user_id=${input.userId}
				AND reward_bucket=${bucket} LIMIT 1
		`;
		if (duplicate.length) return null;
		const totals = await tx`
			SELECT COALESCE(SUM(amount), 0) AS total FROM voice_activity_rewards
			WHERE guild_id=${input.guildId} AND user_id=${input.userId}
				AND reward_date=${rewardDate}
		`;
		const received = moneyToCents(String(totals[0]?.total || '0.00'));
		const remaining = cap - received;
		if (remaining <= 0n) return null;
		const amount = centsToMoney(desired < remaining ? desired : remaining);
		await tx`
			INSERT INTO voice_activity_rewards
				(guild_id, user_id, reward_bucket, reward_date, channel_id, participant_count, amount)
			VALUES (${input.guildId}, ${input.userId}, ${bucket}, ${rewardDate},
				${input.channelId}, ${input.participantCount}, ${amount})
		`;
		await tx`
			UPDATE accounts SET balance=balance+${amount}
			WHERE guild_id=${input.guildId} AND user_id=${input.userId}
		`;
		await tx`
			INSERT INTO transactions
				(guild_id, sender_id, recipient_id, amount, transaction_type)
			VALUES (${input.guildId}, ${null}, ${input.userId}, ${amount}, 'voice_activity')
		`;
		return amount;
	});
}
