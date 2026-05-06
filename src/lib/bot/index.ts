import dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';

dotenv.config();

export const plugin = {
	name: 'discord-bot',
	configureServer() {
		const client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent
			]
		});

		client.once('clientReady', () => {
			console.log(`Logged in as ${client.user?.tag}!`);
		});

		client.login(process.env.BOT_TOKEN);
	}
};
