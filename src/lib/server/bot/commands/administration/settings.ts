import { setCurrencyUnit, setVoiceActivitySettings } from '$lib/server/db/guild-settings';
import { getLanguage } from '$lib/server/bot/i18n';
import { formatMoneyDisplay } from '$lib/economy/money-display';
import { moneyToCents, parseMoney } from '$lib/server/economy/money';
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

function isZeroMoney(value: string) {
	return /^0(?:\.0{1,2})?$/.test(value);
}

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
	)
	.addSubcommand((subcommand) =>
		subcommand
			.setName('voice-reward')
			.setNameLocalizations({ [Locale.Korean]: '음성보상', [Locale.Japanese]: 'ボイス報酬' })
			.setDescription('Configure rewards for voice channel activity.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '음성 채널 활동 보상과 일일 한도를 설정합니다.',
				[Locale.Japanese]: 'ボイスチャンネル活動報酬と1日の上限を設定します。'
			})
			.addStringOption((option) =>
				option
					.setName('reward')
					.setNameLocalizations({ [Locale.Korean]: '기본보상', [Locale.Japanese]: '基本報酬' })
					.setDescription('Base reward per five minutes. Use 0 to disable.')
					.setDescriptionLocalizations({
						[Locale.Korean]: '5분당 기본 보상입니다. 0은 비활성화입니다.',
						[Locale.Japanese]: '5分ごとの基本報酬です。0で無効になります。'
					})
					.setRequired(true)
			)
			.addStringOption((option) =>
				option
					.setName('daily-cap')
					.setNameLocalizations({ [Locale.Korean]: '일일한도', [Locale.Japanese]: '日次上限' })
					.setDescription('Maximum reward per user each day. Use 0 to disable.')
					.setDescriptionLocalizations({
						[Locale.Korean]: '사용자별 하루 최대 보상입니다. 0은 비활성화입니다.',
						[Locale.Japanese]: 'ユーザーごとの1日の最大報酬です。0で無効になります。'
					})
					.setRequired(true)
			)
	);

async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guildId) return;

	const language = getLanguage(interaction.locale);
	const subcommand = interaction.options.getSubcommand();
	if (subcommand === 'voice-reward') {
		const rawReward = interaction.options.getString('reward', true).trim();
		const rawDailyCap = interaction.options.getString('daily-cap', true).trim();
		const disabled = isZeroMoney(rawReward) && isZeroMoney(rawDailyCap);
		const reward = disabled ? '0.00' : parseMoney(rawReward);
		const dailyCap = disabled ? '0.00' : parseMoney(rawDailyCap);
		if (!reward || !dailyCap || (!disabled && moneyToCents(dailyCap) < moneyToCents(reward) * 3n)) {
			await interaction.reply({
				content:
					language === 'ko'
						? '보상과 한도는 0.01 이상이어야 하며, 일일 한도는 1인 채널 1회 보상 이상이어야 합니다.'
						: language === 'ja'
							? '報酬と上限は0.01以上で、日次上限は1人チャンネルの1回分以上にしてください。'
							: 'Reward and cap must be at least 0.01, and the daily cap must cover one solo-channel reward.',
				flags: MessageFlags.Ephemeral
			});
			return;
		}
		await setVoiceActivitySettings(interaction.guildId, { reward, dailyCap });
		const response = disabled
			? {
					en: 'Voice activity rewards are disabled.',
					ko: '음성 활동 보상을 비활성화했습니다.',
					ja: 'ボイスチャンネル活動報酬を無効にしました。'
				}[language]
			: {
					en: `Voice reward: **${formatMoneyDisplay(reward)}** per five minutes · daily cap: **${formatMoneyDisplay(dailyCap)}**.`,
					ko: `5분당 음성 활동 기본 보상: **${formatMoneyDisplay(reward)}** · 일일 한도: **${formatMoneyDisplay(dailyCap)}**`,
					ja: `5分ごとの基本報酬: **${formatMoneyDisplay(reward)}** · 1日の上限: **${formatMoneyDisplay(dailyCap)}**`
				}[language];
		await interaction.reply({
			content: response,
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	const unit = interaction.options.getString('unit', true).trim();
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
