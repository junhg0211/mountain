import { getLanguage } from '$lib/server/bot/i18n';
import { formatMoneyDisplay } from '$lib/economy/money-display';
import { getBalanceRanking } from '$lib/server/db/accounts';
import { getCurrencyUnit, getVisibilitySettings } from '$lib/server/db/guild-settings';
import {
	Locale,
	MessageFlags,
	SlashCommandBuilder,
	type ChatInputCommandInteraction
} from 'discord.js';

const data = new SlashCommandBuilder()
	.setName('ranking')
	.setNameLocalizations({ [Locale.Korean]: '순위', [Locale.Japanese]: 'ランキング' })
	.setDescription('View the server balance ranking.')
	.setDescriptionLocalizations({
		[Locale.Korean]: '서버 소지금 순위를 확인합니다.',
		[Locale.Japanese]: 'サーバーの残高ランキングを表示します。'
	})
	.setDMPermission(false);

async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guildId) return;
	const language = getLanguage(interaction.locale);
	const visibility = await getVisibilitySettings(interaction.guildId);
	if (!visibility.rankingEnabled) {
		const denied = {
			en: 'Balance rankings are disabled.',
			ko: '소지금 순위가 비활성화되어 있습니다.',
			ja: '残高ランキングは無効になっています。'
		};
		await interaction.reply({ content: denied[language], flags: MessageFlags.Ephemeral });
		return;
	}
	const [ranking, unit] = await Promise.all([
		getBalanceRanking(interaction.guildId),
		getCurrencyUnit(interaction.guildId)
	]);
	const titles = { en: 'Balance ranking', ko: '소지금 순위', ja: '残高ランキング' };
	const lines = ranking.map(
		(entry: { rank: number; username: string; balance: string }) =>
			`**${entry.rank}.** ${entry.username} — **${formatMoneyDisplay(entry.balance)} ${unit}**`
	);
	await interaction.reply({
		content: `## ${titles[language]}\n${lines.join('\n') || '-'}`,
		flags: MessageFlags.Ephemeral
	});
}
export default { data, execute };
