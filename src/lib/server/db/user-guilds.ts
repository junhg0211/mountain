import { getDB } from '$lib/server/db';
import type { DiscordGuild } from '$lib/server/discord/users';

export async function syncUserGuilds(userId: string, guilds: DiscordGuild[]): Promise<void> {
	const db = getDB();
	await db.begin(async (tx) => {
		await tx`DELETE FROM user_guilds WHERE user_id = ${userId}`;
		for (const guild of guilds) {
			await tx`
				INSERT INTO user_guilds (user_id, guild_id, guild_name, icon_hash, permissions)
				VALUES (${userId}, ${guild.id}, ${guild.name}, ${guild.icon}, ${guild.permissions})
			`;
		}
	});
}

export function canManageGuild(permissions: string): boolean {
	const value = BigInt(permissions);
	return (value & 8n) !== 0n || (value & 32n) !== 0n;
}
