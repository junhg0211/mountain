import { recordMessageActivity } from '$lib/server/db/member-activity';
import { ensureUser } from '$lib/server/db/users';
import type { Message } from 'discord.js';

export async function handleMemberMessage(message: Message) {
	if (!message.guildId || message.author.bot || message.system) return;
	await ensureUser(
		message.author.id,
		message.member?.displayName || message.author.globalName || message.author.username,
		message.author.displayAvatarURL()
	);
	await recordMessageActivity(message.guildId, message.author.id, message.createdAt);
}
