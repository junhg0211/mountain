import { awardVoiceActivity } from '$lib/server/db/voice-activity';
import { getVoiceActivitySettings } from '$lib/server/db/guild-settings';
import { ensureUser } from '$lib/server/db/users';
import type { Client, GuildMember } from 'discord.js';

const REQUIRED_PRESENCE_MS = 5 * 60 * 1000;
const SCAN_INTERVAL_MS = 60 * 1000;

interface Presence {
	channelId: string;
	since: number;
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
			if (settings.reward === '0.00' || settings.dailyCap === '0.00') continue;
			for (const channel of guild.channels.cache.values()) {
				if (!channel.isVoiceBased()) continue;
				const members = [...channel.members.values()].filter(eligible);
				for (const member of members) {
					const key = `${guild.id}:${member.id}`;
					seen.add(key);
					const presence = presences.get(key);
					if (!presence || presence.channelId !== channel.id) {
						presences.set(key, { channelId: channel.id, since: now });
						continue;
					}
					if (now - presence.since < REQUIRED_PRESENCE_MS) continue;
					await ensureUser(
						member.id,
						member.displayName || member.user.globalName || member.user.username,
						member.user.displayAvatarURL()
					);
					await awardVoiceActivity({
						guildId: guild.id,
						userId: member.id,
						channelId: channel.id,
						participantCount: members.length,
						baseReward: settings.reward,
						dailyCap: settings.dailyCap,
						now: new Date(now)
					});
					presences.set(key, { channelId: channel.id, since: now });
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
