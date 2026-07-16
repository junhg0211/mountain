import { setCurrencyUnit } from '$lib/server/db/guild-settings';
import { getLanguage } from '$lib/server/bot/i18n';
import {
	Locale,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
	type ChatInputCommandInteraction
} from 'discord.js';

const messages = {
	en: (unit: string) =>
		`The currency unit is now **${unit}**. Amounts use two decimal places (minimum: 0.01 ${unit}).`,
	ko: (unit: string) =>
		`경제 단위를 **${unit}**(으)로 설정했습니다. 금액은 소수점 둘째 자리까지 사용합니다 (최소: 0.01 ${unit}).`,
	ja: (unit: string) =>
		`通貨単位を **${unit}** に設定しました。金額は小数点以下2桁まで使用します（最小: 0.01 ${unit}）。`
};

const invalidUnitMessages = {
	en: 'Enter a currency unit containing at least one visible character.',
	ko: '보이는 문자가 하나 이상 포함된 경제 단위를 입력해 주세요.',
	ja: '表示可能な文字を1文字以上含む通貨単位を入力してください。'
};

const data = new SlashCommandBuilder()
	.setName('settings')
	.setNameLocalizations({
		[Locale.Korean]: '설정',
		[Locale.Japanese]: '設定'
	})
	.setDescription('Configure the economy system for this server.')
	.setDescriptionLocalizations({
		[Locale.Korean]: '이 서버의 경제 시스템을 설정합니다.',
		[Locale.Japanese]: 'このサーバーの経済システムを設定します。'
	})
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
	.setDMPermission(false)
	.addSubcommand((subcommand) =>
		subcommand
			.setName('currency')
			.setNameLocalizations({
				[Locale.Korean]: '통화',
				[Locale.Japanese]: '通貨'
			})
			.setDescription('Set the currency unit used by this server.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '이 서버에서 사용할 경제 단위를 설정합니다.',
				[Locale.Japanese]: 'このサーバーで使用する通貨単位を設定します。'
			})
			.addStringOption((option) =>
				option
					.setName('unit')
					.setNameLocalizations({
						[Locale.Korean]: '단위',
						[Locale.Japanese]: '単位'
					})
					.setDescription('Currency name or symbol, such as coin, ₩, or 円.')
					.setDescriptionLocalizations({
						[Locale.Korean]: '코인, ₩ 등 통화 이름이나 기호입니다.',
						[Locale.Japanese]: 'コイン、円などの通貨名または記号です。'
					})
					.setMinLength(1)
					.setMaxLength(16)
					.setRequired(true)
			)
	);

async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guildId) return;

	const unit = interaction.options.getString('unit', true).trim();
	const language = getLanguage(interaction.locale);
	if (!unit) {
		await interaction.reply({
			content: invalidUnitMessages[language],
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	await setCurrencyUnit(interaction.guildId, unit);
	await interaction.reply({ content: messages[language](unit), flags: MessageFlags.Ephemeral });
}

export default { data, execute };
