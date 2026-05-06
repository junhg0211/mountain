import dotenv from 'dotenv';
import { Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import path from 'node:path';
import { readdirSync } from 'node:fs';

dotenv.config();

export const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent
	]
});

const commands = new Map<string, any>();

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = readdirSync(foldersPath);
for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = readdirSync(commandsPath).filter((file) => file.endsWith('.ts'));
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);
		if ('data' in command && 'execute' in command) {
			commands.set(command.data.name, command);
		} else {
			console.log(
				`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`
			);
		}
	}
}

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
