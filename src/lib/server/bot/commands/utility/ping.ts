import { getLanguage } from '$lib/server/bot/i18n';
import { Locale, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

const data = new SlashCommandBuilder()
	.setName('ping')
	.setDescription('Check the bot latency.')
	.setDescriptionLocalizations({
		[Locale.Korean]: '봇의 지연 시간을 확인합니다.',
		[Locale.Japanese]: 'ボットの応答速度を確認します。'
	});

async function execute(interaction: ChatInputCommandInteraction) {
	const latency = Date.now() - interaction.createdTimestamp;
	const language = getLanguage(interaction.locale);
	const labels = { en: 'Latency', ko: '핑', ja: '遅延' };
	await interaction.reply(`:ping_pong: Pong! ${labels[language]}: \`${latency}ms\``);
}

export default {
	data,
	execute
};
