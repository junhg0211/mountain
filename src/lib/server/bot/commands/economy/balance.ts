import { getLanguage } from '$lib/server/bot/i18n';
import { formatMoneyDisplay } from '$lib/economy/money-display';
import { ensureUser } from '$lib/server/db/users';
import { getOrCreateBalance } from '$lib/server/db/accounts';
import { getCurrencyUnit, getVisibilitySettings } from '$lib/server/db/guild-settings';
import {
	Locale,
	MessageFlags,
	SlashCommandBuilder,
	type ChatInputCommandInteraction
} from 'discord.js';

const data = new SlashCommandBuilder()
	.setName('balance')
	.setNameLocalizations({
		[Locale.Korean]: '잔액',
		[Locale.Japanese]: '残高'
	})
	.setDescription('Check your current balance.')
	.setDescriptionLocalizations({
		[Locale.Korean]: '현재 소지금을 확인합니다.',
		[Locale.Japanese]: '現在の所持金を確認します。'
	})
	.addUserOption((option) =>
		option
			.setName('user')
			.setNameLocalizations({ [Locale.Korean]: '사용자', [Locale.Japanese]: 'ユーザー' })
			.setDescription('User whose balance you want to check.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '소지금을 확인할 사용자입니다.',
				[Locale.Japanese]: '残高を確認するユーザーです。'
			})
			.setRequired(false)
	)
	.setDMPermission(false);

async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guildId) return;

	const user = interaction.options.getUser('user') || interaction.user;
	if (user.id !== interaction.user.id) {
		const visibility = await getVisibilitySettings(interaction.guildId);
		if (!visibility.publicBalanceEnabled) {
			const denied = {
				en: 'Viewing other users’ balances is disabled.',
				ko: '다른 사용자의 소지금 조회가 비활성화되어 있습니다.',
				ja: '他のユーザーの残高確認は無効になっています。'
			};
			await interaction.reply({
				content: denied[getLanguage(interaction.locale)],
				flags: MessageFlags.Ephemeral
			});
			return;
		}
	}
	await ensureUser(user.id, user.globalName || user.username, user.displayAvatarURL());

	const [balance, currencyUnit] = await Promise.all([
		getOrCreateBalance(interaction.guildId, user.id),
		getCurrencyUnit(interaction.guildId)
	]);
	const language = getLanguage(interaction.locale);
	const messages = {
		en: `${user.id === interaction.user.id ? 'Your' : `${user.username}'s`} balance is **${formatMoneyDisplay(balance)} ${currencyUnit}**.`,
		ko: `${user.id === interaction.user.id ? '현재' : `${user.username}님의`} 소지금은 **${formatMoneyDisplay(balance)} ${currencyUnit}**입니다.`,
		ja: `${user.id === interaction.user.id ? '現在の' : `${user.username}の`}所持金は **${formatMoneyDisplay(balance)} ${currencyUnit}** です。`
	};

	await interaction.reply({ content: messages[language], flags: MessageFlags.Ephemeral });
}

export default { data, execute };
