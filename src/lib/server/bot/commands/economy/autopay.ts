import { cancelScheduledTransfer, createScheduledTransfer, getUserAutomaticPayments } from '$lib/server/db/automatic-payments';
import { ensureUser } from '$lib/server/db/users';
import { parseMoney } from '$lib/server/economy/money';
import { getLanguage } from '$lib/server/bot/i18n';
import { Locale, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

const data = new SlashCommandBuilder()
	.setName('autopay').setNameLocalizations({ [Locale.Korean]: '자동송금', [Locale.Japanese]: '自動送金' })
	.setDescription('Manage recurring transfers.').setDescriptionLocalizations({ [Locale.Korean]: '정기 자동 송금을 관리합니다.', [Locale.Japanese]: '定期自動送金を管理します。' }).setDMPermission(false)
	.addSubcommand((s) => s.setName('list').setNameLocalizations({ [Locale.Korean]: '목록', [Locale.Japanese]: '一覧' }).setDescription('List recurring transfers.').setDescriptionLocalizations({ [Locale.Korean]: '자동 송금 목록을 봅니다.', [Locale.Japanese]: '自動送金の一覧を表示します。' }))
	.addSubcommand((s) => s.setName('create').setNameLocalizations({ [Locale.Korean]: '등록', [Locale.Japanese]: '登録' }).setDescription('Create a recurring transfer.').setDescriptionLocalizations({ [Locale.Korean]: '자동 송금을 등록합니다.', [Locale.Japanese]: '自動送金を登録します。' })
		.addUserOption((o) => o.setName('user').setNameLocalizations({ [Locale.Korean]: '사용자', [Locale.Japanese]: 'ユーザー' }).setDescription('Recipient.').setRequired(true))
		.addStringOption((o) => o.setName('amount').setNameLocalizations({ [Locale.Korean]: '금액', [Locale.Japanese]: '金額' }).setDescription('Amount, minimum 0.01.').setRequired(true))
		.addStringOption((o) => o.setName('schedule').setNameLocalizations({ [Locale.Korean]: '주기', [Locale.Japanese]: '周期' }).setDescription('Schedule type.').setRequired(true).addChoices({ name: 'Every N days', value: 'interval' }, { name: 'Weekly', value: 'weekly' }, { name: 'Monthly', value: 'monthly' }))
		.addIntegerOption((o) => o.setName('value').setNameLocalizations({ [Locale.Korean]: '주기값', [Locale.Japanese]: '周期値' }).setDescription('Days, weekday (0=Sun), or day of month.').setRequired(true).setMinValue(0).setMaxValue(365))
		.addIntegerOption((o) => o.setName('hour').setNameLocalizations({ [Locale.Korean]: '시', [Locale.Japanese]: '時' }).setDescription('KST hour.').setRequired(true).setMinValue(0).setMaxValue(23))
		.addIntegerOption((o) => o.setName('minute').setNameLocalizations({ [Locale.Korean]: '분', [Locale.Japanese]: '分' }).setDescription('Minute.').setRequired(true).setMinValue(0).setMaxValue(59)))
	.addSubcommand((s) => s.setName('cancel').setNameLocalizations({ [Locale.Korean]: '해지', [Locale.Japanese]: '解除' }).setDescription('Cancel a recurring transfer.').setDescriptionLocalizations({ [Locale.Korean]: '자동 송금을 해지합니다.', [Locale.Japanese]: '自動送金を解除します。' }).addStringOption((o) => o.setName('id').setDescription('Transfer ID.').setRequired(true)));

const messages = {
	invalid: { en: 'Check the recipient, amount, and schedule value.', ko: '받는 사람, 금액, 주기 값을 확인해 주세요.', ja: '受取人、金額、周期値を確認してください。' },
	created: { en: 'Recurring transfer created. It will not charge now.', ko: '자동 송금을 등록했습니다. 지금은 결제되지 않습니다.', ja: '自動送金を登録しました。今すぐの決済はありません。' },
	cancelled: { en: 'Recurring transfer cancelled.', ko: '자동 송금을 해지했습니다.', ja: '自動送金を解除しました。' }
};

async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guildId) return;
	const language = getLanguage(interaction.locale), sub = interaction.options.getSubcommand();
	if (sub === 'list') {
		const { transfers } = await getUserAutomaticPayments(interaction.guildId, interaction.user.id);
		const content = transfers.length ? transfers.map((item: { id: string; recipientId: string; amount: string; status: string; nextRunAt: number }) => `#${item.id} · <@${item.recipientId}> · ${item.amount} · ${item.status} · <t:${Math.floor(item.nextRunAt / 1000)}:F>`).join('\n') : language === 'ko' ? '등록된 자동 송금이 없습니다.' : language === 'ja' ? '登録された自動送金はありません。' : 'No recurring transfers.';
		await interaction.reply({ content, flags: MessageFlags.Ephemeral }); return;
	}
	if (sub === 'cancel') {
		await cancelScheduledTransfer(interaction.guildId, interaction.user.id, interaction.options.getString('id', true));
		await interaction.reply({ content: messages.cancelled[language], flags: MessageFlags.Ephemeral }); return;
	}
	const recipient = interaction.options.getUser('user', true), amount = parseMoney(interaction.options.getString('amount', true));
	const type = interaction.options.getString('schedule', true) as 'interval' | 'weekly' | 'monthly';
	const value = interaction.options.getInteger('value', true), hour = interaction.options.getInteger('hour', true), minute = interaction.options.getInteger('minute', true);
	const valid = recipient.id !== interaction.user.id && !recipient.bot && amount && ((type === 'interval' && value >= 1) || (type === 'weekly' && value <= 6) || (type === 'monthly' && value >= 1 && value <= 28));
	if (!valid) { await interaction.reply({ content: messages.invalid[language], flags: MessageFlags.Ephemeral }); return; }
	await Promise.all([ensureUser(interaction.user.id, interaction.user.globalName || interaction.user.username, interaction.user.displayAvatarURL()), ensureUser(recipient.id, recipient.globalName || recipient.username, recipient.displayAvatarURL())]);
	const schedule = type === 'interval' ? { type, intervalDays: value, hour, minute } as const : type === 'weekly' ? { type, weekday: value, hour, minute } as const : { type, monthDay: value, hour, minute } as const;
	await createScheduledTransfer(interaction.guildId, interaction.user.id, recipient.id, amount, schedule);
	await interaction.reply({ content: messages.created[language], flags: MessageFlags.Ephemeral });
}

export default { data, execute };
