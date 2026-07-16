import dotenv from 'dotenv';
import { Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import settings from './commands/administration/settings';
import ping from './commands/utility/ping';
import { getLanguage } from './i18n';

dotenv.config();

let client: Client | null = null;
let startPromise: Promise<void> | null = null;

const commands = new Map([
	[ping.data.name, ping],
	[settings.data.name, settings]
]);

async function reloadCommands() {
	const rest = new REST().setToken(process.env.BOT_TOKEN!);

	try {
		console.log(`Started refreshing ${commands.size} application (/) commands.`);

		const data = (await rest.put(Routes.applicationCommands(process.env.CLIENT_ID!), {
			body: [...commands.values()].map((command) => command.data.toJSON())
		})) as unknown[];

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

			try {
				await command.execute(interaction);
			} catch (error) {
				console.error(`Command ${interaction.commandName} failed:`, error);
				const messages = {
					en: 'The command could not be completed. Please try again later.',
					ko: '명령을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
					ja: 'コマンドを完了できませんでした。しばらくしてからもう一度お試しください。'
				};
				const message = messages[getLanguage(interaction.locale)];
				if (interaction.replied || interaction.deferred) {
					await interaction.followUp({ content: message, ephemeral: true });
				} else {
					await interaction.reply({ content: message, ephemeral: true });
				}
			}
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

export { reloadCommands };
