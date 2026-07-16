import { getNotificationChannel } from '$lib/server/db/guild-settings';

export async function sendTransactionNotification(guildId: string, content: string): Promise<void> {
	const channelId = await getNotificationChannel(guildId);
	if (!channelId || !process.env.BOT_TOKEN) return;
	try {
		const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
			method: 'POST',
			headers: {
				Authorization: `Bot ${process.env.BOT_TOKEN}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ content, allowed_mentions: { parse: [] } })
		});
		if (!response.ok) throw new Error(`Discord message request failed (${response.status}).`);
	} catch (error) {
		console.error('Transaction notification failed:', error);
	}
}
