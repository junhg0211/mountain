import { getRelatedMemories, isValidMemoryDate, koreanDate } from '$lib/server/db/daily-memories';
import { formatRelatedMemories } from '$lib/server/bot/memory-interactions';
import { Locale, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

const data = new SlashCommandBuilder()
	.setName('memory')
	.setNameLocalizations({ [Locale.Korean]: '추억', [Locale.Japanese]: '思い出' })
	.setDescription('Look back at memories connected to today.')
	.setDescriptionLocalizations({
		[Locale.Korean]: '오늘과 이어지는 지난 기록을 돌아봅니다.',
		[Locale.Japanese]: '今日につながる過去の記録を振り返ります。'
	})
	.addStringOption((option) =>
		option
			.setName('date')
			.setNameLocalizations({ [Locale.Korean]: '날짜', [Locale.Japanese]: '日付' })
			.setDescription('Base date in YYYY-MM-DD format. Defaults to today.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '연결 기록을 볼 기준 날짜입니다 (YYYY-MM-DD, 기본값: 오늘).',
				[Locale.Japanese]: '関連記録を見る基準日です（YYYY-MM-DD、既定値: 今日）。'
			})
			.setMinLength(10)
			.setMaxLength(10)
	)
	.setDMPermission(false);

async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guildId) return;
	const today = koreanDate().date;
	const date = interaction.options.getString('date')?.trim() || today;
	if (!isValidMemoryDate(date, today)) {
		await interaction.reply({
			content: '날짜를 YYYY-MM-DD 형식의 오늘 또는 과거 날짜로 입력해 주세요.',
			ephemeral: true
		});
		return;
	}
	const memories = await getRelatedMemories(interaction.guildId, date);
	await interaction.reply({ content: formatRelatedMemories(date, memories) });
}

export default { data, execute };
