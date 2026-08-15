import { awardVoiceActivity } from '$lib/server/db/voice-activity';
import { getVoiceActivitySettings } from '$lib/server/db/guild-settings';
import { ensureUser } from '$lib/server/db/users';
import { recordVoiceActivity } from '$lib/server/db/member-activity';
import type { Client, GuildMember } from 'discord.js';

const REQUIRED_PRESENCE_MS = 5 * 60 * 1000;
const ACTIVITY_INTERVAL_MS = 45 * 1000;
const SCAN_INTERVAL_MS = 15 * 1000;

interface Presence {
	channelId: string;
	activitySince: number;
	rewardSince: number;
}

const presences = new Map<string, Presence>();
let scanTimer: ReturnType<typeof setInterval> | null = null;
let scanRunning = false;

function eligible(member: GuildMember) {
	return !member.user.bot && !member.voice.deaf;
}

async function scan(client: Client) {
	if (scanRunning) return;
	scanRunning = true;
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
					const elapsedActivityIntervals = Math.floor(
						(now - presence.activitySince) / ACTIVITY_INTERVAL_MS
					);
					const rewardDue = now - presence.rewardSince >= REQUIRED_PRESENCE_MS;
					if (elapsedActivityIntervals < 1 && !rewardDue) continue;
					await ensureUser(
						member.id,
						member.displayName || member.user.globalName || member.user.username,
						member.user.displayAvatarURL()
					);
					if (elapsedActivityIntervals > 0) {
						await recordVoiceActivity(
							guild.id,
							member.id,
							(elapsedActivityIntervals * ACTIVITY_INTERVAL_MS) / 1000,
							new Date(now)
						);
						presence.activitySince += elapsedActivityIntervals * ACTIVITY_INTERVAL_MS;
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
	} finally {
		scanRunning = false;
	}
}

export function startVoiceActivityRewards(client: Client) {
	if (scanTimer) return;
	void scan(client);
	scanTimer = setInterval(() => void scan(client), SCAN_INTERVAL_MS);
	scanTimer.unref();
}

export function stopVoiceActivityRewards() {
	if (scanTimer) clearInterval(scanTimer);
	scanTimer = null;
	presences.clear();
}
