import dotenv from 'dotenv';
import { Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import ping from './commands/utility/ping';

dotenv.config();

export const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent
	]
});

const commands = new Map<string, any>([[ping.data.name, ping]]);

const rest = new REST().setToken(process.env.BOT_TOKEN!);

(async () => {
	try {
		console.log(`Started refreshing ${commands.size} application (/) commands.`);

		const data: any = await rest.put(Routes.applicationCommands(process.env.CLIENT_ID!), {
			body: [...commands.values()].map((command) => command.data.toJSON())
		});

		console.log(`Successfully reloaded ${data.length} application (/) commands.`);
	} catch (error) {
		console.error(error);
	}
})();

export const plugin = {
	name: 'discord-bot',
	configureServer() {
		client.once(Events.ClientReady, () => {
			console.log(`Logged in as ${client.user?.tag}!`);
		});

		client.on(Events.InteractionCreate, async (interaction) => {
			if (!interaction.isChatInputCommand()) return;

			const command = commands.get(interaction.commandName);

			if (!command) {
				console.error(`No command matching ${interaction.commandName} was found.`);
				return;
			}

			await command.execute(interaction);
		});

		client.login(process.env.BOT_TOKEN);
	}
};
