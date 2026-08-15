import { awardVoiceActivity } from '$lib/server/db/voice-activity';
import { getVoiceActivitySettings } from '$lib/server/db/guild-settings';
import { ensureUser } from '$lib/server/db/users';
import { recordVoiceActivity } from '$lib/server/db/member-activity';
import type { Client, GuildMember } from 'discord.js';

const REQUIRED_PRESENCE_MS = 5 * 60 * 1000;
const SCAN_INTERVAL_MS = 15 * 1000;

interface Presence {
	channelId: string;
	activitySince: number;
	rewardSince: number;
}

const presences = new Map<string, Presence>();
let scanTimer: ReturnType<typeof setInterval> | null = null;
let scanPromise: Promise<void> | null = null;
let activeClient: Client | null = null;

function eligible(member: GuildMember) {
	return !member.user.bot && !member.voice.deaf;
}

async function runScan(client: Client) {
	const now = Date.now();
	const seen = new Set<string>();
	try {
		for (const guild of client.guilds.cache.values()) {
			const settings = await getVoiceActivitySettings(guild.id);
			for (const channel of guild.channels.cache.values()) {
				if (!channel.isVoiceBased()) continue;
				const members = [...channel.members.values()].filter(eligible);
				for (const member of members) {
					const key = `${guild.id}:${member.id}`;
					seen.add(key);
					const presence = presences.get(key);
					if (!presence || presence.channelId !== channel.id) {
						presences.set(key, { channelId: channel.id, activitySince: now, rewardSince: now });
						continue;
					}
					const elapsedActivitySeconds = Math.floor((now - presence.activitySince) / 1000);
					const rewardDue = now - presence.rewardSince >= REQUIRED_PRESENCE_MS;
					if (elapsedActivitySeconds < 1 && !rewardDue) continue;
					await ensureUser(
						member.id,
						member.displayName || member.user.globalName || member.user.username,
						member.user.displayAvatarURL()
					);
					if (elapsedActivitySeconds > 0) {
						await recordVoiceActivity(guild.id, member.id, elapsedActivitySeconds, new Date(now));
						presence.activitySince += elapsedActivitySeconds * 1000;
					}
					if (rewardDue && settings.reward !== '0.00' && settings.dailyCap !== '0.00') {
						await awardVoiceActivity({
							guildId: guild.id,
							userId: member.id,
							channelId: channel.id,
							participantCount: members.length,
							baseReward: settings.reward,
							dailyCap: settings.dailyCap,
							now: new Date(now)
						});
					}
					if (rewardDue) presence.rewardSince = now;
				}
			}
		}
		for (const key of presences.keys()) if (!seen.has(key)) presences.delete(key);
	} catch (error) {
		console.error('Voice activity reward scan failed:', error);
	}
}

function scan(client: Client): Promise<void> {
	if (scanPromise) return scanPromise;
	scanPromise = runScan(client).finally(() => {
		scanPromise = null;
	});
	return scanPromise;
}

export function startVoiceActivityRewards(client: Client) {
	if (scanTimer) return;
	activeClient = client;
	void scan(client);
	scanTimer = setInterval(() => void scan(client), SCAN_INTERVAL_MS);
	scanTimer.unref();
}

export async function stopVoiceActivityRewards() {
	if (scanTimer) clearInterval(scanTimer);
	scanTimer = null;
	if (activeClient) {
		await scan(activeClient);
		await scan(activeClient);
	}
	activeClient = null;
	presences.clear();
}
