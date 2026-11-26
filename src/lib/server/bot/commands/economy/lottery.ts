import {
	Locale,
	MessageFlags,
	SlashCommandBuilder,
	type ChatInputCommandInteraction
} from 'discord.js';
import {
	buyLottery,
	getLotteryResult,
	getLotteryStatus,
	getLotteryTickets,
	initializeLottery,
	LotteryError,
	LotteryIntegrityError
} from '$lib/server/db/lottery';
import { ensureUser } from '$lib/server/db/users';
import { getCurrencyUnit } from '$lib/server/db/guild-settings';
import { centsToMoney, moneyToCents } from '$lib/server/economy/money';
import { lotteryNumber } from '$lib/server/economy/lottery';
import {
	alertLotteryIntegrity,
	formatLotteryResult,
	splitLotteryMessage
} from '$lib/server/bot/lottery';

const data = new SlashCommandBuilder()
	.setName('lottery')
	.setNameLocalizations({ [Locale.Korean]: '복권', [Locale.Japanese]: '宝くじ' })
	.setDescription('Buy TOKUN lottery tickets and view weekly results.')
	.setDescriptionLocalizations({
		ko: '토쿤 복권을 구매하고 매주 추첨 결과를 확인합니다.',
		ja: 'TOKUN宝くじの購入と毎週の抽選結果を確認します。'
	})
	.setDMPermission(false);
const commands = [
	['buy', '구매', '購入', 'Buy lottery tickets.', '복권을 구매합니다.', '宝くじを購入します。'],
	[
		'status',
		'현황',
		'状況',
		'View the current round and fund.',
		'현재 회차와 복권기금을 확인합니다.',
		'現在の回と基金を確認します。'
	],
	[
		'tickets',
		'내복권',
		'購入履歴',
		'View your own tickets.',
		'자신이 구매한 복권을 확인합니다.',
		'自分が購入した宝くじを確認します。'
	],
	[
		'result',
		'결과',
		'結果',
		'View a completed draw.',
		'추첨이 완료된 회차의 결과를 확인합니다.',
		'終了した回の抽選結果を確認します。'
	],
	[
		'rules',
		'규칙',
		'ルール',
		'Read lottery rules and odds.',
		'복권 규칙과 당첨 확률을 확인합니다.',
		'宝くじのルールと当選確率を確認します。'
	]
];
for (const [name, ko, ja, description, descKo, descJa] of commands)
	data.addSubcommand((sub) => {
		sub
			.setName(name)
			.setNameLocalizations({ ko, ja })
			.setDescription(description)
			.setDescriptionLocalizations({ ko: descKo, ja: descJa });
		if (name === 'buy') {
			sub.addIntegerOption((o) =>
				o
					.setName('number')
					.setNameLocalizations({ ko: '번호', ja: '番号' })
					.setDescription('Ticket number (random if omitted).')
					.setDescriptionLocalizations({
						ko: '복권 번호 (생략 시 무작위)',
						ja: '宝くじ番号（省略時はランダム）'
					})
					.setMinValue(0)
					.setMaxValue(399)
			);
			sub.addIntegerOption((o) =>
				o
					.setName('count')
					.setNameLocalizations({ ko: '수량', ja: '枚数' })
					.setDescription('Number of tickets (default: 1).')
					.setDescriptionLocalizations({
						ko: '구매 수량 (기본값 1장)',
						ja: '購入枚数（初期値1枚）'
					})
					.setMinValue(1)
					.setMaxValue(5)
			);
		}
		if (name === 'tickets' || name === 'result')
			sub.addIntegerOption((o) =>
				o
					.setName('round')
					.setNameLocalizations({ ko: '회차', ja: '回' })
					.setDescription('Round number.')
					.setDescriptionLocalizations({ ko: '조회할 회차 번호', ja: '表示する回の番号' })
					.setMinValue(1)
					.setMaxValue(2147483647)
			);
		return sub;
	});

const rules = `🎟️ 토쿤 복권 규칙
1장 1 TOKUN · 회차당 최대 5장 · 번호 000~399
번호와 수량은 선택 사항이며 기본 수량은 1장입니다. 번호를 생략하면 각 장을 무작위로 발급하고, 지정하면 같은 번호로 구매합니다. 중복 번호를 허용하며 변경·환불은 불가능합니다.
매주 토요일 오전 9시 (Asia/Seoul) 판매 마감·추첨. 400개 번호 중 17개를 중복 없이 추첨합니다.
1등 2개 (1/200, 가중치 5) · 2등 5개 (1/80, 가중치 2) · 3등 10개 (1/40, 가중치 1).
당첨금 = 복권기금 × 60% × 개인 당첨 가중치 / 전체 당첨 가중치. 동일 번호의 여러 장도 각각 계산합니다.
당첨금과 소각액은 0.01 TOKUN 미만을 절사합니다. 당첨자가 있으면 60% 배당·10% 소각·잔액 이월, 없으면 (판매 0장도 포함) 10% 소각·90% 이월합니다. 절사 잔액도 이월합니다.
복권기금은 봇 계정에 보관하며 일반 자금으로 사용할 수 없습니다. 당첨금은 추가 발행 없이 기금에서 지급합니다. 오프라인 중 마감된 회차는 재시작 후 순서대로 정산합니다.
공시는 서버 설정의 거래 알림 채널에 게시합니다.`;
async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guildId || !interaction.inCachedGuild()) return;
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	// Resolve live membership on the server before returning personal records or accepting a debit.
	const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
	if (member.user.bot) {
		await interaction.editReply('봇은 복권을 구매할 수 없습니다.');
		return;
	}
	const guild = interaction.guildId;
	await ensureUser(
		interaction.user.id,
		interaction.user.globalName || interaction.user.username,
		interaction.user.displayAvatarURL()
	);
	const unit = await getCurrencyUnit(guild);
	const action = interaction.options.getSubcommand();
	let content: string;
	try {
		await initializeLottery(guild, interaction.client.user.id);
		if (action === 'buy') {
			const r = await buyLottery(
				guild,
				interaction.user.id,
				interaction.options.getInteger('count') ?? 1,
				interaction.options.getInteger('number') ?? undefined
			);
			content = `🎟️ 제${r.round}회 토쿤 복권 구매 완료!\n\n복권 번호: ${r.numbers.map(lotteryNumber).join(', ')}\n구매 금액: ${r.cost} ${unit}\n구매 한도: ${r.count}/5장\n보유 잔액: ${r.balance} ${unit}\n\n💰 현재 복권기금: ${r.fund} ${unit}\n🏆 예상 전체 당첨금: ${r.estimated} ${unit}\n\n추첨: <t:${Math.floor(r.closesAt / 1000)}:F> (토요일 오전 9시, 한국 시간)`;
		} else if (action === 'status') {
			const r = await getLotteryStatus(guild);
			content = `🎟️ 제${r.round_number}회 토쿤 복권\n이전 회차 이월금: ${r.carry_in} ${unit}\n현재 회차 판매액: ${r.sales} ${unit}\n전체 복권기금: ${r.fund} ${unit}\n판매된 복권: ${r.ticket_count}장\n예상 전체 당첨금: ${centsToMoney((moneyToCents(String(r.fund)) * 60n) / 100n)} ${unit}\n다음 추첨: <t:${Math.floor(Number(r.closes_at) / 1000)}:F> (Asia/Seoul)${Number(r.closes_at) <= Date.now() ? '\n판매 마감 · 정산 대기 중' : ''}`;
		} else if (action === 'tickets') {
			const r = await getLotteryTickets(
				guild,
				interaction.user.id,
				interaction.options.getInteger('round') ?? undefined
			);
			content =
				`🎟️ 제${r.round}회 내 복권\n` +
				(r.tickets
					.map(
						(t) =>
							`${t.id}\n번호 ${lotteryNumber(Number(t.number))} · ${t.status !== 'settled' ? '추첨·정산 대기' : t.rank_number ? `${t.rank_number}등 당첨` : '낙첨'} · 당첨금 ${t.payout} ${unit}`
					)
					.join('\n\n') || '구매 내역이 없습니다.');
		} else if (action === 'result') {
			const r = await getLotteryResult(guild, interaction.options.getInteger('round') ?? undefined);
			content = r ? formatLotteryResult(r, unit) : '추첨이 완료된 회차가 없습니다.';
		} else content = rules;
	} catch (error) {
		if (error instanceof LotteryIntegrityError) await alertLotteryIntegrity(guild, error);
		if (!(error instanceof LotteryError)) throw error;
		content = error.message;
	}
	const [first, ...rest] = splitLotteryMessage(content);
	await interaction.editReply({ content: first, allowedMentions: { parse: [] } });
	for (const chunk of rest)
		await interaction.followUp({
			content: chunk,
			flags: MessageFlags.Ephemeral,
			allowedMentions: { parse: [] }
		});
}
export default { data, execute };
