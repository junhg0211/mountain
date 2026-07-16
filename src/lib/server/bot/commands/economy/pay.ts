import { getLanguage } from '$lib/server/bot/i18n';
import { sendTransactionNotification } from '$lib/server/bot/notifications';
import { InsufficientBalanceError, transferBalance } from '$lib/server/db/accounts';
import { getCurrencyUnit } from '$lib/server/db/guild-settings';
import { ensureUser } from '$lib/server/db/users';
import { parseMoney } from '$lib/server/economy/money';
import {
	Locale,
	MessageFlags,
	SlashCommandBuilder,
	type ChatInputCommandInteraction
} from 'discord.js';

const data = new SlashCommandBuilder()
	.setName('pay')
	.setNameLocalizations({
		[Locale.Korean]: '송금',
		[Locale.Japanese]: '送金'
	})
	.setDescription('Send money to another user.')
	.setDescriptionLocalizations({
		[Locale.Korean]: '다른 사용자에게 돈을 보냅니다.',
		[Locale.Japanese]: '他のユーザーにお金を送ります。'
	})
	.setDMPermission(false)
	.addUserOption((option) =>
		option
			.setName('user')
			.setNameLocalizations({
				[Locale.Korean]: '사용자',
				[Locale.Japanese]: 'ユーザー'
			})
			.setDescription('User who will receive the money.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '돈을 받을 사용자입니다.',
				[Locale.Japanese]: 'お金を受け取るユーザーです。'
			})
			.setRequired(true)
	)
	.addStringOption((option) =>
		option
			.setName('amount')
			.setNameLocalizations({
				[Locale.Korean]: '금액',
				[Locale.Japanese]: '金額'
			})
			.setDescription('Amount to send (minimum 0.01).')
			.setDescriptionLocalizations({
				[Locale.Korean]: '보낼 금액입니다 (최소 0.01).',
				[Locale.Japanese]: '送金額です（最小0.01）。'
			})
			.setRequired(true)
	);

const messages = {
	invalidAmount: {
		en: 'Enter an amount of at least 0.01 with no more than two decimal places.',
		ko: '0.01 이상이며 소수점 둘째 자리까지인 금액을 입력해 주세요.',
		ja: '0.01以上で、小数点以下2桁までの金額を入力してください。'
	},
	self: {
		en: 'You cannot send money to yourself.',
		ko: '자기 자신에게는 송금할 수 없습니다.',
		ja: '自分自身に送金することはできません。'
	},
	bot: {
		en: 'You cannot send money to a bot.',
		ko: '봇에게는 송금할 수 없습니다.',
		ja: 'ボットに送金することはできません。'
	},
	insufficient: {
		en: 'You do not have enough money.',
		ko: '소지금이 부족합니다.',
		ja: '所持金が不足しています。'
	}
};

async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guildId) return;

	const language = getLanguage(interaction.locale);
	const recipient = interaction.options.getUser('user', true);
	const amount = parseMoney(interaction.options.getString('amount', true).trim());

	if (!amount) {
		await interaction.reply({
			content: messages.invalidAmount[language],
			flags: MessageFlags.Ephemeral
		});
		return;
	}
	if (recipient.id === interaction.user.id) {
		await interaction.reply({ content: messages.self[language], flags: MessageFlags.Ephemeral });
		return;
	}
	if (recipient.bot) {
		await interaction.reply({ content: messages.bot[language], flags: MessageFlags.Ephemeral });
		return;
	}

	await Promise.all([
		ensureUser(
			interaction.user.id,
			interaction.user.globalName || interaction.user.username,
			interaction.user.displayAvatarURL()
		),
		ensureUser(
			recipient.id,
			recipient.globalName || recipient.username,
			recipient.displayAvatarURL()
		)
	]);

	try {
		const [remainingBalance, currencyUnit] = await Promise.all([
			transferBalance(interaction.guildId, interaction.user.id, recipient.id, amount),
			getCurrencyUnit(interaction.guildId)
		]);
		const success = {
			en: `Sent **${amount} ${currencyUnit}** to ${recipient}. Remaining balance: **${remainingBalance} ${currencyUnit}**.`,
			ko: `${recipient}님에게 **${amount} ${currencyUnit}**을(를) 보냈습니다. 남은 소지금: **${remainingBalance} ${currencyUnit}**.`,
			ja: `${recipient} に **${amount} ${currencyUnit}** を送金しました。残高: **${remainingBalance} ${currencyUnit}**。`
		};
		await sendTransactionNotification(
			interaction.guildId,
			`💸 **송금**\n보낸 사용자: <@${interaction.user.id}>\n받는 사용자: <@${recipient.id}>\n금액: **${amount} ${currencyUnit}**`
		);
		await interaction.reply({ content: success[language], flags: MessageFlags.Ephemeral });
	} catch (error) {
		if (error instanceof InsufficientBalanceError) {
			await interaction.reply({
				content: messages.insufficient[language],
				flags: MessageFlags.Ephemeral
			});
			return;
		}
		throw error;
	}
}

export default { data, execute };
