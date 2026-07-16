import dotenv from 'dotenv';
import { Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import ping from './commands/utility/ping';

dotenv.config();

let client: Client | null = null;
let startPromise: Promise<void> | null = null;

const commands = new Map<string, any>([[ping.data.name, ping]]);

async function reloadCommands() {
	const rest = new REST().setToken(process.env.BOT_TOKEN!);

	try {
		console.log(`Started refreshing ${commands.size} application (/) commands.`);

		const data: any = await rest.put(Routes.applicationCommands(process.env.CLIENT_ID!), {
			body: [...commands.values()].map((command) => command.data.toJSON())
		});

		console.log(`Successfully reloaded ${data.length} application (/) commands.`);
	} catch (error) {
		console.error(error);
	}
}

async function start() {
	if (!process.env.BOT_TOKEN) {
		console.warn('BOT_TOKEN is not configured; Discord bot startup skipped.');
		return;
	}

	if (!process.env.CLIENT_ID) throw new Error('CLIENT_ID is required to start the Discord bot.');

	if (process.env.REGISTER_COMMANDS === 'true') await reloadCommands();

	await new Promise<void>((resolve, reject) => {
		client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent
			]
		});

		client.once(Events.ClientReady, () => {
			console.log(`Logged in as ${client?.user?.tag}!`);
			resolve();
		});
		client.once(Events.Error, reject);

		client.on(Events.InteractionCreate, async (interaction) => {
			if (!interaction.isChatInputCommand()) return;

			const command = commands.get(interaction.commandName);

			if (!command) {
				console.error(`No command matching ${interaction.commandName} was found.`);
				return;
			}

			await command.execute(interaction);
		});

		void client.login(process.env.BOT_TOKEN);
	});
}

export function startBot(): Promise<void> {
	startPromise ??= start().catch((cause) => {
		startPromise = null;
		throw cause;
	});
	return startPromise;
}

export function getClient() {
	return client;
}
