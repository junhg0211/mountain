import { getLanguage } from '$lib/server/bot/i18n';
import { formatMoneyDisplay } from '$lib/economy/money-display';
import {
	calculateFiatValue,
	getFiatEconomy
} from '$lib/server/db/fiat-economy';
import { getCurrencyUnit } from '$lib/server/db/guild-settings';
import { getDB } from '$lib/server/db';
import { parseMoney } from '$lib/server/economy/money';
import {
	Locale,
	MessageFlags,
	SlashCommandBuilder,
	type SlashCommandStringOption,
	type ChatInputCommandInteraction
} from 'discord.js';

const data = new SlashCommandBuilder()
	.setName('economy')
	.setNameLocalizations({ [Locale.Korean]: '경제', [Locale.Japanese]: '経済' })
	.setDescription('View reported reserve-backed economy information and calculations.')
	.setDescriptionLocalizations({
		[Locale.Korean]: '신고 준비금 기반 경제 정보와 계산을 조회합니다.',
		[Locale.Japanese]: '申告準備金に基づく経済情報と計算を確認します。'
	})
	.setDMPermission(false)
	.addSubcommand((subcommand) =>
		subcommand
			.setName('exchange-rate')
			.setNameLocalizations({ [Locale.Korean]: '환율', [Locale.Japanese]: '為替レート' })
			.setDescription('View the current reported exchange rate.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '현재 신고 준비금 기반 환율을 확인합니다.',
				[Locale.Japanese]: '現在の申告準備金ベースの為替レートを確認します。'
			})
	)
	.addSubcommand((subcommand) =>
		subcommand
			.setName('convert')
			.setNameLocalizations({ [Locale.Korean]: '환산', [Locale.Japanese]: '換算' })
			.setDescription('Calculate the reported fiat value of server currency.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '서버 화폐의 신고 기준 현실 가치를 계산합니다.',
				[Locale.Japanese]: 'サーバー通貨の申告基準の現実価値を計算します。'
			})
			.addStringOption(amountOption)
	)
	.addSubcommand((subcommand) =>
		subcommand
			.setName('redemption-cost')
			.setNameLocalizations({ [Locale.Korean]: '환전비용', [Locale.Japanese]: '換金費用' })
			.setDescription('Calculate the ledger value for a hypothetical reserve-linked burn.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '가상의 준비금 연계 소각에 대한 장부상 금액을 계산합니다.',
				[Locale.Japanese]: '仮想の準備金連動バーンに対する台帳上の金額を計算します。'
			})
			.addStringOption(amountOption)
	)
	.addSubcommand((subcommand) =>
		subcommand
			.setName('real-value')
			.setNameLocalizations({ [Locale.Korean]: '현실가치', [Locale.Japanese]: '現実価値' })
			.setDescription('View the reported fiat value of your current balance.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '내 현재 소지금의 신고 기준 현실 가치를 확인합니다.',
				[Locale.Japanese]: '現在の所持金の申告基準の現実価値を確認します。'
			})
	);

function amountOption(option: SlashCommandStringOption) {
	return option
		.setName('amount')
		.setNameLocalizations({ [Locale.Korean]: '금액', [Locale.Japanese]: '金額' })
		.setDescription('Server-currency amount, at least 0.01.')
		.setDescriptionLocalizations({
			[Locale.Korean]: '0.01 이상의 서버 화폐 금액입니다.',
			[Locale.Japanese]: '0.01以上のサーバー通貨額です。'
		})
		.setRequired(true);
}

async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guildId) return;
	const language = getLanguage(interaction.locale);
	const [snapshot, unit] = await Promise.all([
		getFiatEconomy(interaction.guildId),
		getCurrencyUnit(interaction.guildId)
	]);
	if (!snapshot.enabled || !snapshot.exchangeRatePublic) {
		await interaction.reply({
			content: {
				en: 'Reported exchange-rate information is not publicly available in this server.',
				ko: '이 서버에서는 신고 준비금 기반 환율 정보를 공개하지 않습니다.',
				ja: 'このサーバーでは申告準備金ベースの為替情報を公開していません。'
			}[language],
			flags: MessageFlags.Ephemeral
		});
		return;
	}
	const command = interaction.options.getSubcommand();
	let amount: string | null = null;
	if (command !== 'exchange-rate') {
		if (command === 'real-value') {
			const db = await getDB();
			const rows = await db`SELECT COALESCE(balance, 0.00) AS balance FROM accounts WHERE guild_id=${interaction.guildId} AND user_id=${interaction.user.id} LIMIT 1`;
			amount = String(rows[0]?.balance || '0.00');
		} else {
			amount = parseMoney(interaction.options.getString('amount', true).trim());
		}
		if (!amount || amount === '0.00') {
			await interaction.reply({ content: language === 'ko' ? '0.01 이상의 금액을 입력해 주세요.' : language === 'ja' ? '0.01以上の金額を入力してください。' : 'Enter an amount of at least 0.01.', flags: MessageFlags.Ephemeral });
			return;
		}
	}
	const rate = snapshot.exchangeRate
		? `${snapshot.exchangeRate} ${snapshot.currencyCode}/${unit}`
		: language === 'ko'
			? '산정 불가'
			: language === 'ja'
				? '算定不可'
				: 'unavailable';
	const calculated = amount ? calculateFiatValue(snapshot, amount) : null;
	const line = amount && calculated
		? language === 'ko'
			? `**${formatMoneyDisplay(amount)} ${unit}** → **${formatMoneyDisplay(calculated)} ${snapshot.currencyCode}**`
			: language === 'ja'
				? `**${formatMoneyDisplay(amount)} ${unit}** → **${formatMoneyDisplay(calculated)} ${snapshot.currencyCode}**`
				: `**${formatMoneyDisplay(amount)} ${unit}** → **${formatMoneyDisplay(calculated)} ${snapshot.currencyCode}**`
		: '';
	const heading = command === 'exchange-rate' ? 'Exchange rate · 환율' : command === 'real-value' ? 'Reported value · 현실 가치' : command === 'redemption-cost' ? 'Reserve-linked burn calculation · 준비금 연계 소각 계산' : 'Conversion · 환산';
	await interaction.reply({
		content: `## ${heading}\n${language === 'ko' ? '현재 환율' : 'Current rate'}: **${rate}**${line ? `\n${line}` : ''}${snapshot.payoutNotice ? `\n\n${snapshot.payoutNotice}` : ''}`,
		flags: MessageFlags.Ephemeral
	});
}

export default { data, execute };
