import {
	getRelatedMemories,
	isValidMemoryDate,
	koreanDate,
	saveDailyMemory
} from '$lib/server/db/daily-memories';
import {
	ActionRowBuilder,
	MessageFlags,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	type ButtonInteraction,
	type ModalSubmitInteraction
} from 'discord.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function formatRelatedMemories(
	baseDate: string,
	memories: Awaited<ReturnType<typeof getRelatedMemories>>
) {
	if (!memories.length)
		return `🗓️ **${baseDate}을 기준으로 이어지는 추억**\n아직 이 날짜와 이어지는 기록이 없어요.`;
	const lines = memories.map((memory) => {
		const compact = memory.content.replace(/\s+/g, ' ').trim();
		const excerpt = compact.length > 180 ? `${compact.slice(0, 177)}…` : compact;
		return `**${memory.label} · ${memory.date} · ${memory.username}**\n${excerpt}`;
	});
	return `🗓️ **${baseDate}을 기준으로 이어지는 추억**\n\n${lines.join('\n\n')}`.slice(0, 1_990);
}

function interactionDate(customId: string) {
	const date = customId.split(':')[2];
	return DATE_PATTERN.test(date || '') ? date : null;
}

export async function handleMemoryButton(interaction: ButtonInteraction) {
	if (!interaction.customId.startsWith('memory:')) return false;
	const date = interactionDate(interaction.customId);
	if (!date || !interaction.guildId) {
		await interaction.reply({
			content: '이 기록 요청은 더 이상 사용할 수 없어요.',
			flags: MessageFlags.Ephemeral
		});
		return true;
	}
	if (interaction.customId.startsWith('memory:write:')) {
		const dateInput = new TextInputBuilder()
			.setCustomId('date')
			.setLabel('기록할 날짜 (YYYY-MM-DD)')
			.setPlaceholder('2026-08-21')
			.setStyle(TextInputStyle.Short)
			.setValue(date)
			.setMinLength(10)
			.setMaxLength(10)
			.setRequired(true);
		const input = new TextInputBuilder()
			.setCustomId('content')
			.setLabel('서버에 어떤 일이 있었나요?')
			.setPlaceholder('함께 기억하고 싶은 일을 편하게 적어 주세요.')
			.setStyle(TextInputStyle.Paragraph)
			.setMinLength(1)
			.setMaxLength(1000)
			.setRequired(true);
		await interaction.showModal(
			new ModalBuilder()
				.setCustomId('memory:submit')
				.setTitle('서버 기록 남기기')
				.addComponents(
					new ActionRowBuilder<TextInputBuilder>().addComponents(dateInput),
					new ActionRowBuilder<TextInputBuilder>().addComponents(input)
				)
		);
		return true;
	}
	const memories = await getRelatedMemories(interaction.guildId, date);
	await interaction.reply({ content: formatRelatedMemories(date, memories) });
	return true;
}

export async function handleMemoryModal(interaction: ModalSubmitInteraction) {
	if (interaction.customId !== 'memory:submit') return false;
	const date = interaction.fields.getTextInputValue('date').trim();
	const today = koreanDate().date;
	if (!isValidMemoryDate(date, today) || !interaction.guildId) {
		await interaction.reply({
			content: '날짜를 YYYY-MM-DD 형식의 오늘 또는 과거 날짜로 입력해 주세요.',
			flags: MessageFlags.Ephemeral
		});
		return true;
	}
	const content = interaction.fields.getTextInputValue('content').trim();
	const reward = await saveDailyMemory({
		guildId: interaction.guildId,
		userId: interaction.user.id,
		username: interaction.user.username,
		entryDate: date,
		content
	});
	const memories = await getRelatedMemories(interaction.guildId, date);
	await interaction.reply({
		content:
			`✅ **${date}의 서버 기록을 저장했어요.**${reward === '0.00' ? '' : ` 첫 기록 보상 **${reward}**도 받았어요.`} 나중에 다시 적으면 내 기록이 수정됩니다.\n\n${formatRelatedMemories(date, memories)}`.slice(
				0,
				1_990
			),
		flags: MessageFlags.Ephemeral
	});
	return true;
}
