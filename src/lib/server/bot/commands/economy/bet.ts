import { getLanguage, type SupportedLanguage } from '$lib/server/bot/i18n';
import { sendTransactionNotification } from '$lib/server/bot/notifications';
import { InsufficientBalanceError } from '$lib/server/db/accounts';
import {
	BettingParticipantError,
	BettingOptionError,
	BettingPermissionError,
	BettingPoolClosedError,
	BettingPoolNotFoundError,
	createTeamBettingPool,
	getBettingPool,
	getBettingPools,
	placeBet,
	placeTeamBet,
	refundBettingPool,
	settleBettingPool,
	settleTeamBettingPool
} from '$lib/server/db/betting';
import { getCurrencyUnit } from '$lib/server/db/guild-settings';
import { ensureUser } from '$lib/server/db/users';
import { parseMoney } from '$lib/server/economy/money';
import { publishBettingUpdate } from '$lib/server/realtime';
import {
	Locale,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
	type ChatInputCommandInteraction
} from 'discord.js';

const data = new SlashCommandBuilder()
	.setName('bet')
	.setNameLocalizations({ [Locale.Korean]: '베팅', [Locale.Japanese]: 'ベット' })
	.setDescription('Create and manage server betting pools.')
	.setDescriptionLocalizations({
		[Locale.Korean]: '서버 베팅 판을 만들고 관리합니다.',
		[Locale.Japanese]: 'サーバーのベットを作成・管理します。'
	})
	.setDMPermission(false)
	.addSubcommand((command) =>
		command
			.setName('create')
			.setNameLocalizations({ [Locale.Korean]: '만들기', [Locale.Japanese]: '作成' })
			.setDescription('Create a betting pool.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '새 베팅 판을 만듭니다.',
				[Locale.Japanese]: '新しいベットを作成します。'
			})
			.addStringOption((option) =>
				option
					.setName('title')
					.setNameLocalizations({ [Locale.Korean]: '제목', [Locale.Japanese]: 'タイトル' })
					.setDescription('Betting pool title.')
					.setDescriptionLocalizations({
						[Locale.Korean]: '베팅 판 제목입니다.',
						[Locale.Japanese]: 'ベットのタイトルです。'
					})
					.setMaxLength(80)
					.setRequired(true)
			)
	)
	.addSubcommand((command) =>
		command
			.setName('list')
			.setNameLocalizations({ [Locale.Korean]: '목록', [Locale.Japanese]: '一覧' })
			.setDescription('List recent betting pools.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '최근 베팅 판을 확인합니다.',
				[Locale.Japanese]: '最近のベットを表示します。'
			})
	)
	.addSubcommand((command) =>
		command
			.setName('view')
			.setNameLocalizations({ [Locale.Korean]: '보기', [Locale.Japanese]: '表示' })
			.setDescription('View participants and stakes.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '참가자와 베팅액을 확인합니다.',
				[Locale.Japanese]: '参加者とベット額を表示します。'
			})
			.addStringOption(poolIdOption)
	)
	.addSubcommand((command) =>
		command
			.setName('join')
			.setNameLocalizations({ [Locale.Korean]: '참가', [Locale.Japanese]: '参加' })
			.setDescription('Stake money in a betting pool.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '베팅 판에 돈을 겁니다.',
				[Locale.Japanese]: 'ベットに参加してお金を賭けます。'
			})
			.addStringOption(poolIdOption)
			.addStringOption((option) =>
				option
					.setName('amount')
					.setNameLocalizations({ [Locale.Korean]: '금액', [Locale.Japanese]: '金額' })
					.setDescription('Amount to stake (minimum 0.01).')
					.setDescriptionLocalizations({
						[Locale.Korean]: '걸 금액입니다 (최소 0.01).',
						[Locale.Japanese]: '賭ける金額です（最小0.01）。'
					})
					.setRequired(true)
			)
			.addStringOption(teamOption)
	)
	.addSubcommand((command) =>
		command
			.setName('settle')
			.setNameLocalizations({ [Locale.Korean]: '정산', [Locale.Japanese]: '精算' })
			.setDescription('Give the entire pot to one participant.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '판돈 전부를 참가자 한 명에게 지급합니다.',
				[Locale.Japanese]: '全額を参加者1人に支払います。'
			})
			.addStringOption(poolIdOption)
			.addUserOption((option) =>
				option
					.setName('winner')
					.setNameLocalizations({ [Locale.Korean]: '승자', [Locale.Japanese]: '勝者' })
					.setDescription('Participant who receives the entire pot.')
					.setDescriptionLocalizations({
						[Locale.Korean]: '판돈 전부를 받을 참가자입니다.',
						[Locale.Japanese]: '全額を受け取る参加者です。'
					})
					.setRequired(false)
			)
			.addStringOption(teamOption)
	)
	.addSubcommand((command) =>
		command
			.setName('refund')
			.setNameLocalizations({ [Locale.Korean]: '환불', [Locale.Japanese]: '返金' })
			.setDescription('Return every participant’s stake.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '모든 참가자에게 건 금액을 돌려줍니다.',
				[Locale.Japanese]: '全参加者に賭け金を返金します。'
			})
			.addStringOption(poolIdOption)
	);

function poolIdOption(option: import('discord.js').SlashCommandStringOption) {
	return option
		.setName('pool')
		.setNameLocalizations({ [Locale.Korean]: '판', [Locale.Japanese]: 'ベット' })
		.setDescription('Betting pool ID.')
		.setDescriptionLocalizations({
			[Locale.Korean]: '베팅 판 번호입니다.',
			[Locale.Japanese]: 'ベット番号です。'
		})
		.setRequired(true);
}

function teamOption(option: import('discord.js').SlashCommandStringOption) {
	return option
		.setName('team')
		.setNameLocalizations({ [Locale.Korean]: '팀', [Locale.Japanese]: 'チーム' })
		.setDescription('Team A or B.')
		.setDescriptionLocalizations({
			[Locale.Korean]: '베팅하거나 정산할 A팀 또는 B팀입니다.',
			[Locale.Japanese]: 'ベットまたは精算するAチームかBチームです。'
		})
		.addChoices({ name: 'A team', value: 'A' }, { name: 'B team', value: 'B' })
		.setRequired(false);
}

async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guildId) return;
	const language = getLanguage(interaction.locale);
	const subcommand = interaction.options.getSubcommand();
	const privateResponse = subcommand === 'list' || subcommand === 'view';
	await interaction.deferReply(privateResponse ? { flags: MessageFlags.Ephemeral } : {});

	try {
		await ensureUser(
			interaction.user.id,
			interaction.user.globalName || interaction.user.username,
			interaction.user.displayAvatarURL()
		);
		const unit = await getCurrencyUnit(interaction.guildId);

		if (subcommand === 'create') {
			const title = interaction.options.getString('title', true).trim();
			if (!title)
				return void (await interaction.editReply(
					localize(
						language,
						'Enter a title.',
						'제목을 입력해 주세요.',
						'タイトルを入力してください。'
					)
				));
			const id = await createTeamBettingPool(interaction.guildId, interaction.user.id, title);
			publishBettingUpdate(interaction.guildId, id);
			await sendTransactionNotification(
				interaction.guildId,
				`🎲 **베팅 판 생성**\n#${id} ${title}\n판 주인: ${interaction.user}`
			);
			await interaction.editReply(
				localize(
					language,
					`🎲 Created betting pool **#${id} ${title}**.`,
					`🎲 베팅 판 **#${id} ${title}**을(를) 만들었습니다.`,
					`🎲 ベット **#${id} ${title}** を作成しました。`
				)
			);
			return;
		}

		if (subcommand === 'list') {
			const pools = await getBettingPools(interaction.guildId);
			const lines = pools.map(
				(pool) =>
					`**#${pool.id} ${pool.title}** · ${statusLabel(pool.status, language)}\n${pool.totalAmount} ${unit} · ${pool.participantCount} participants · host ${pool.ownerName}`
			);
			await interaction.editReply(
				lines.join('\n\n') ||
					localize(
						language,
						'No betting pools yet.',
						'아직 베팅 판이 없습니다.',
						'ベットはまだありません。'
					)
			);
			return;
		}

		const poolId = interaction.options.getString('pool', true);
		if (!/^\d+$/.test(poolId)) throw new BettingPoolNotFoundError();

		if (subcommand === 'view') {
			const pool = await getBettingPool(interaction.guildId, poolId);
			if (!pool) throw new BettingPoolNotFoundError();
			const participants = pool.participants.map(
				(entry, index) =>
					`${index + 1}. ${entry.optionKey ? `**${entry.optionKey}팀** · ` : ''}**${entry.username}** — ${entry.amount} ${unit}`
			);
			const visibleParticipants = participants.slice(0, 25);
			if (participants.length > visibleParticipants.length)
				visibleParticipants.push(`… and ${participants.length - visibleParticipants.length} more`);
			await interaction.editReply(
				`## #${pool.id} ${pool.title}\n${statusLabel(pool.status, language)} · host ${pool.ownerName}\n**${pool.totalAmount} ${unit}** · ${pool.participantCount} participants\n\n${visibleParticipants.join('\n') || '-'}`
			);
			return;
		}

		if (subcommand === 'join') {
			const amount = parseMoney(interaction.options.getString('amount', true).trim());
			if (!amount) {
				await interaction.editReply(
					localize(
						language,
						'Enter a valid amount of at least 0.01.',
						'0.01 이상의 올바른 금액을 입력해 주세요.',
						'0.01以上の正しい金額を入力してください。'
					)
				);
				return;
			}
			const poolBefore = await getBettingPool(interaction.guildId, poolId);
			const team = interaction.options.getString('team');
			const remaining =
				poolBefore?.bettingMode === 'team'
					? team === 'A' || team === 'B'
						? await placeTeamBet(interaction.guildId, poolId, interaction.user.id, team, amount)
						: null
					: await placeBet(interaction.guildId, poolId, interaction.user.id, amount);
			if (remaining === null) {
				await interaction.editReply(
					localize(
						language,
						'Choose team A or B.',
						'A팀 또는 B팀을 선택해 주세요.',
						'AチームかBチームを選択してください。'
					)
				);
				return;
			}
			const pool = await getBettingPool(interaction.guildId, poolId);
			publishBettingUpdate(interaction.guildId, poolId);
			await sendTransactionNotification(
				interaction.guildId,
				`🎟️ **베팅 참가**\n#${poolId} ${pool?.title || ''}\n참가자: ${interaction.user}\n추가 베팅: **${amount} ${unit}**\n판돈: **${pool?.totalAmount || amount} ${unit}**`
			);
			await interaction.editReply(
				localize(
					language,
					`🎟️ Staked **${amount} ${unit}** on #${poolId}. Remaining: **${remaining} ${unit}**.`,
					`🎟️ #${poolId}에 **${amount} ${unit}**을(를) 걸었습니다. 남은 소지금: **${remaining} ${unit}**.`,
					`🎟️ #${poolId} に **${amount} ${unit}** を賭けました。残高: **${remaining} ${unit}**。`
				)
			);
			return;
		}

		const canOverride = Boolean(
			interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
		);
		if (subcommand === 'settle') {
			const pool = await getBettingPool(interaction.guildId, poolId);
			const team = interaction.options.getString('team');
			if (pool?.bettingMode === 'team') {
				if (team !== 'A' && team !== 'B') {
					await interaction.editReply(
						localize(
							language,
							'Choose the winning team.',
							'승리 팀을 선택해 주세요.',
							'勝利チームを選択してください。'
						)
					);
					return;
				}
				const result = await settleTeamBettingPool(
					interaction.guildId,
					poolId,
					interaction.user.id,
					team,
					canOverride
				);
				publishBettingUpdate(interaction.guildId, poolId);
				await interaction.editReply(
					`🏆 ${team}팀 승리 · ${result.winnerCount}명에게 **${result.total} ${unit}** 비례 지급`
				);
				return;
			}
			const winner = interaction.options.getUser('winner');
			if (!winner) throw new BettingParticipantError();
			const payout = await settleBettingPool(
				interaction.guildId,
				poolId,
				interaction.user.id,
				winner.id,
				canOverride
			);
			publishBettingUpdate(interaction.guildId, poolId);
			await sendTransactionNotification(
				interaction.guildId,
				`🏆 **베팅 정산**\n#${poolId}\n승자: ${winner}\n지급액: **${payout} ${unit}**\n처리자: ${interaction.user}`
			);
			await interaction.editReply(
				localize(
					language,
					`🏆 ${winner} received the entire pot of **${payout} ${unit}**.`,
					`🏆 ${winner}님에게 판돈 **${payout} ${unit}** 전부를 지급했습니다.`,
					`🏆 ${winner} に全額 **${payout} ${unit}** を支払いました。`
				)
			);
			return;
		}

		const pool = await getBettingPool(interaction.guildId, poolId);
		const count = await refundBettingPool(
			interaction.guildId,
			poolId,
			interaction.user.id,
			canOverride
		);
		publishBettingUpdate(interaction.guildId, poolId);
		await sendTransactionNotification(
			interaction.guildId,
			`↩️ **베팅 환불**\n#${poolId} ${pool?.title || ''}\n${count}명에게 총 **${pool?.totalAmount || '0.00'} ${unit}** 환불\n처리자: ${interaction.user}`
		);
		await interaction.editReply(
			localize(
				language,
				`↩ Refunded all stakes to ${count} participants.`,
				`↩ 참가자 ${count}명에게 베팅액을 모두 환불했습니다.`,
				`↩ ${count}人の参加者に全額返金しました。`
			)
		);
	} catch (error) {
		await interaction.editReply(bettingError(error, language));
	}
}

function bettingError(error: unknown, language: SupportedLanguage) {
	if (error instanceof InsufficientBalanceError)
		return localize(
			language,
			'You do not have enough money.',
			'소지금이 부족합니다.',
			'所持金が不足しています。'
		);
	if (error instanceof BettingPoolNotFoundError)
		return localize(
			language,
			'Betting pool not found.',
			'베팅 판을 찾을 수 없습니다.',
			'ベットが見つかりません。'
		);
	if (error instanceof BettingPoolClosedError)
		return localize(
			language,
			'This betting pool is already closed.',
			'이미 종료된 베팅 판입니다.',
			'このベットは終了しています。'
		);
	if (error instanceof BettingOptionError)
		return localize(
			language,
			'Choose team A or B. You cannot switch teams after staking.',
			'A팀 또는 B팀을 선택해 주세요. 한 번 베팅한 뒤에는 팀을 바꿀 수 없습니다.',
			'AチームかBチームを選択してください。ベット後はチームを変更できません。'
		);
	if (error instanceof BettingPermissionError)
		return localize(
			language,
			'Only the host can settle or refund this pool.',
			'판 주인만 정산하거나 환불할 수 있습니다.',
			'主催者のみ精算または返金できます。'
		);
	if (error instanceof BettingParticipantError)
		return localize(
			language,
			'Choose a participant as the winner.',
			'참가자 중에서 승자를 선택해 주세요.',
			'参加者から勝者を選んでください。'
		);
	throw error;
}

function statusLabel(status: string, language: SupportedLanguage) {
	if (status === 'settled') return localize(language, 'settled', '정산 완료', '精算済み');
	if (status === 'refunded') return localize(language, 'refunded', '환불 완료', '返金済み');
	return localize(language, 'open', '진행 중', '受付中');
}

function localize(language: SupportedLanguage, en: string, ko: string, ja: string) {
	return { en, ko, ja }[language];
}

export default { data, execute };
