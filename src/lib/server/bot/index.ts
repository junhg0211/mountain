import dotenv from 'dotenv';
import { closeDB } from '$lib/server/db';
import {
	Client,
	Events,
	GatewayIntentBits,
	MessageFlags,
	REST,
	Routes,
	type ChatInputCommandInteraction,
	type RESTPostAPIChatInputApplicationCommandsJSONBody
} from 'discord.js';
import settings from './commands/administration/settings';
import attendance from './commands/economy/attendance';
import balance from './commands/economy/balance';
import bet from './commands/economy/bet';
import pay from './commands/economy/pay';
import ranking from './commands/economy/ranking';
import dashboard from './commands/utility/dashboard';
import { getLanguage } from './i18n';
import { startVoiceActivityRewards, stopVoiceActivityRewards } from './voice-activity';

dotenv.config();

interface BotState {
	client: Client | null;
	startPromise: Promise<void> | null;
	shutdownHandlersRegistered: boolean;
	shuttingDown: boolean;
}

const globalState = globalThis as typeof globalThis & { __mountainBot?: BotState };
const state = (globalState.__mountainBot ??= {
	client: null,
	startPromise: null,
	shutdownHandlersRegistered: false,
	shuttingDown: false
});

async function shutdown(signal: NodeJS.Signals) {
	if (state.shuttingDown) return;
	state.shuttingDown = true;
	console.log(`${signal} received. Shutting down Mountain...`);

	const forceExit = setTimeout(() => {
		console.error('Graceful shutdown timed out; forcing process exit.');
		process.exit(1);
	}, 5_000);
	forceExit.unref();

	try {
		stopVoiceActivityRewards();
		state.client?.removeAllListeners();
		state.client?.destroy();
		state.client = null;
		state.startPromise = null;
		await closeDB();
		console.log('Mountain shut down cleanly.');
		clearTimeout(forceExit);
		process.exit(0);
	} catch (error) {
		console.error('Mountain shutdown failed:', error);
		clearTimeout(forceExit);
		process.exit(1);
	}
}

function registerShutdownHandlers() {
	if (state.shutdownHandlersRegistered) return;
	state.shutdownHandlersRegistered = true;
	process.once('SIGINT', () => void shutdown('SIGINT'));
	process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

registerShutdownHandlers();

interface Command {
	data: {
		name: string;
		toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
	};
	execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

const commands = new Map<string, Command>([
	[settings.data.name, settings],
	[attendance.data.name, attendance],
	[balance.data.name, balance],
	[bet.data.name, bet],
	[pay.data.name, pay],
	[ranking.data.name, ranking],
	[dashboard.data.name, dashboard]
]);

const LOGIN_RETRY_DELAYS = [5_000, 15_000, 30_000, 60_000] as const;

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

	let attempt = 0;
	while (!state.shuttingDown) {
		const client = new Client({
			intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
		});
		state.client = client;
		client.once(Events.ClientReady, () => {
			console.log(`Logged in as ${client.user?.tag}!`);
			startVoiceActivityRewards(client);
		});
		client.on(Events.Error, (error) => console.error('Discord client error:', error));
		bindInteractionHandler(client);

		try {
			await client.login(process.env.BOT_TOKEN);
			return;
		} catch (error) {
			client.removeAllListeners();
			client.destroy();
			if (state.client === client) state.client = null;
			if (state.shuttingDown) return;

			const delay = LOGIN_RETRY_DELAYS[Math.min(attempt, LOGIN_RETRY_DELAYS.length - 1)];
			attempt += 1;
			console.error(
				`Discord login failed. The web server will stay online; retrying in ${delay / 1000}s.`,
				error
			);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
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
				await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
			} else {
				await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
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
