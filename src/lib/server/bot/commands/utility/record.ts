import { isValidMemoryDate, koreanDate, saveDailyMemory } from '$lib/server/db/daily-memories';
import { getCurrencyUnit } from '$lib/server/db/guild-settings';
import { formatMoneyDisplay } from '$lib/economy/money-display';
import { getLanguage } from '$lib/server/bot/i18n';
import {
	Locale,
	MessageFlags,
	SlashCommandBuilder,
	type ChatInputCommandInteraction
} from 'discord.js';

const data = new SlashCommandBuilder()
	.setName('record')
	.setNameLocalizations({ [Locale.Korean]: '기록', [Locale.Japanese]: '記録' })
	.setDescription('Add an entry to this server’s shared history.')
	.setDescriptionLocalizations({
		[Locale.Korean]: '이 서버의 공동 기록에 원하는 날짜의 일을 남깁니다.',
		[Locale.Japanese]: 'このサーバーの共有記録に指定した日付の出来事を残します。'
	})
	.addStringOption((option) =>
		option
			.setName('date')
			.setNameLocalizations({ [Locale.Korean]: '날짜', [Locale.Japanese]: '日付' })
			.setDescription('Date to record in YYYY-MM-DD format.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '기록할 날짜입니다 (YYYY-MM-DD).',
				[Locale.Japanese]: '記録する日付です（YYYY-MM-DD）。'
			})
			.setMinLength(10)
			.setMaxLength(10)
			.setRequired(true)
	)
	.addStringOption((option) =>
		option
			.setName('content')
			.setNameLocalizations({ [Locale.Korean]: '내용', [Locale.Japanese]: '内容' })
			.setDescription('What happened on that date.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '서버에 있었던 일을 적어 주세요.',
				[Locale.Japanese]: 'サーバーで起きた出来事を入力してください。'
			})
			.setMinLength(1)
			.setMaxLength(1000)
			.setRequired(true)
	)
	.setDMPermission(false);

async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guildId) return;
	const language = getLanguage(interaction.locale);
	const date = interaction.options.getString('date', true).trim();
	const content = interaction.options.getString('content', true).trim();
	if (!isValidMemoryDate(date, koreanDate().date)) {
		await interaction.reply({
			content: {
				en: 'Enter today or a past date in YYYY-MM-DD format.',
				ko: '날짜를 YYYY-MM-DD 형식의 오늘 또는 과거 날짜로 입력해 주세요.',
				ja: '今日または過去の日付をYYYY-MM-DD形式で入力してください。'
			}[language],
			flags: MessageFlags.Ephemeral
		});
		return;
	}
	if (!content) {
		await interaction.reply({
			content: {
				en: 'Enter at least one visible character.',
				ko: '보이는 문자가 하나 이상 포함된 내용을 입력해 주세요.',
				ja: '表示可能な文字を1文字以上入力してください。'
			}[language],
			flags: MessageFlags.Ephemeral
		});
		return;
	}
	const reward = await saveDailyMemory({
		guildId: interaction.guildId,
		userId: interaction.user.id,
		username:
			interaction.member && 'displayName' in interaction.member
				? interaction.member.displayName
				: interaction.user.username,
		entryDate: date,
		content
	});
	const unit = reward === '0.00' ? null : await getCurrencyUnit(interaction.guildId);
	await interaction.reply({
		content: {
			en: `📝 Saved <@${interaction.user.id}>’s server memory for **${date}**.${unit ? ` First-entry reward: **${formatMoneyDisplay(reward)} ${unit}**` : ''}`,
			ko: `📝 <@${interaction.user.id}>님의 **${date}** 서버 기록을 저장했어요.${unit ? ` 첫 기록 보상: **${formatMoneyDisplay(reward)} ${unit}**` : ''}`,
			ja: `📝 <@${interaction.user.id}>さんの**${date}**のサーバー記録を保存しました。${unit ? ` 初回記録報酬: **${formatMoneyDisplay(reward)} ${unit}**` : ''}`
		}[language]
	});
}

export default { data, execute };
