import { getLanguage } from '$lib/server/bot/i18n';
import { ensureUser } from '$lib/server/db/users';
import { getOrCreateBalance } from '$lib/server/db/accounts';
import { getCurrencyUnit } from '$lib/server/db/guild-settings';
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
	.setDMPermission(false);

async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guildId) return;

	const user = interaction.user;
	await ensureUser(user.id, user.globalName || user.username, user.displayAvatarURL());

	const [balance, currencyUnit] = await Promise.all([
		getOrCreateBalance(interaction.guildId, user.id),
		getCurrencyUnit(interaction.guildId)
	]);
	const language = getLanguage(interaction.locale);
	const messages = {
		en: `Your balance is **${balance} ${currencyUnit}**.`,
		ko: `현재 소지금은 **${balance} ${currencyUnit}**입니다.`,
		ja: `現在の所持金は **${balance} ${currencyUnit}** です。`
	};

	await interaction.reply({ content: messages[language], flags: MessageFlags.Ephemeral });
}

export default { data, execute };
