import { afterAll, expect, test } from 'bun:test';
import {
	MessageFlags,
	type ChatInputCommandInteraction,
	type ModalSubmitInteraction
} from 'discord.js';
import crypt from './crypt';
import { executeDh, handleDhModal } from './crypt-dh';
const previous = process.env.DH_SIGNING_KEY;
process.env.DH_SIGNING_KEY = 'ef'.repeat(32);
afterAll(() => {
	if (previous === undefined) delete process.env.DH_SIGNING_KEY;
	else process.env.DH_SIGNING_KEY = previous;
});
function fake(mode: string) {
	const replies: Array<{ content: string }> = [];
	const flags: number[] = [];
	const interaction = {
		guildId: '12345678901234567890',
		user: { id: '98765432101234567890' },
		inGuild: () => true,
		options: { getSubcommand: () => mode, getString: () => null },
		client: { guilds: { fetch: async () => ({ members: { fetch: async () => ({}) } }) } },
		deferred: false,
		replied: false,
		deferReply: async (options: { flags: number }) => {
			flags.push(options.flags);
			interaction.deferred = true;
		},
		editReply: async (reply: string | { content: string }) => {
			replies.push(typeof reply === 'string' ? { content: reply } : reply);
		},
		reply: async (reply: { content: string; flags: number }) => {
			flags.push(reply.flags);
			replies.push(reply);
		}
	};
	return { interaction, replies, flags };
}
test('all subcommands registered with three locales and valid Discord schema', () => {
	const json = crypt.data.toJSON();
	expect(json.options?.length).toBe(5);
	for (const option of json.options ?? []) {
		expect(option.name_localizations?.ko).toBeDefined();
		expect(option.name_localizations?.ja).toBeDefined();
		expect(option.description_localizations?.ko).toBeDefined();
		expect(option.description_localizations?.ja).toBeDefined();
	}
});
test('private key replies are ephemeral and fit Discord with full snowflakes', async () => {
	const mock = fake('keypair');
	expect(await executeDh(mock.interaction as unknown as ChatInputCommandInteraction)).toBe(true);
	expect(mock.flags).toEqual([MessageFlags.Ephemeral]);
	expect(mock.replies[0].content).toContain('DH1.');
	expect(mock.replies[0].content.length).toBeLessThanOrEqual(2000);
});
test('modal errors are ephemeral, sanitized and never escape even when Discord fails', async () => {
	const mock = fake('shared');
	const secret = 'secret-input-must-not-appear';
	const interaction = Object.assign(mock.interaction, {
		customId: 'mountain-dh:shared',
		fields: { getTextInputValue: () => secret }
	});
	expect(await handleDhModal(interaction as unknown as ModalSubmitInteraction)).toBe(true);
	expect(mock.flags).toEqual([MessageFlags.Ephemeral]);
	expect(JSON.stringify(mock.replies)).not.toContain(secret);
	const failing = {
		...interaction,
		deferReply: async () => {
			throw new Error(secret);
		},
		reply: async () => {
			throw new Error(secret);
		}
	};
	expect(await handleDhModal(failing as unknown as ModalSubmitInteraction)).toBe(true);
});
