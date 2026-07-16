import dotenv from 'dotenv';
import { Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import settings from './commands/administration/settings';
import balance from './commands/economy/balance';
import ping from './commands/utility/ping';
import { getLanguage } from './i18n';

dotenv.config();

interface BotState {
	client: Client | null;
	startPromise: Promise<void> | null;
}

const globalState = globalThis as typeof globalThis & { __mountainBot?: BotState };
const state = (globalState.__mountainBot ??= { client: null, startPromise: null });

const commands = new Map([
	[ping.data.name, ping],
	[settings.data.name, settings],
	[balance.data.name, balance]
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
		state.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent
			]
		});

		state.client.once(Events.ClientReady, () => {
			console.log(`Logged in as ${state.client?.user?.tag}!`);
			resolve();
		});
		state.client.once(Events.Error, reject);
		bindInteractionHandler(state.client);
		void state.client.login(process.env.BOT_TOKEN);
	});
}

function bindInteractionHandler(client: Client) {
	client.removeAllListeners(Events.InteractionCreate);
	client.on(Events.InteractionCreate, async (interaction) => {
		if (!interaction.isChatInputCommand()) return;

		const command = commands.get(interaction.commandName);

		if (!command) return;

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
}

export function startBot(): Promise<void> {
	if (state.client?.isReady()) {
		bindInteractionHandler(state.client);
		return Promise.resolve();
	}

	state.startPromise ??= start().catch((cause) => {
		state.startPromise = null;
		throw cause;
	});
	return state.startPromise;
}

export function getClient() {
	return state.client;
}

export { reloadCommands };
