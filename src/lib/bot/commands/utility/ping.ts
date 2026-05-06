import { SlashCommandBuilder, type Interaction } from 'discord.js';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
	.setName('ping')
	.setDescription('`Pong!`을 반환합니다.');

export async function execute(interaction: Interaction) {
	if (!interaction.isChatInputCommand()) return;

	const latency = Date.now() - interaction.createdTimestamp;
	await interaction.reply(`:ping_pong: Pong! 핑: \`${latency}ms\``);
}
