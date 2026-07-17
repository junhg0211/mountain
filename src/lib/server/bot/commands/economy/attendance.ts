import { getLanguage } from '$lib/server/bot/i18n';
import { formatMoneyDisplay } from '$lib/economy/money-display';
import { sendTransactionNotification } from '$lib/server/bot/notifications';
import {
	AttendanceAlreadyClaimedError,
	AttendanceDisabledError,
	claimAttendance,
	getAttendanceLeaderboard
} from '$lib/server/db/attendance';
import { getCurrencyUnit } from '$lib/server/db/guild-settings';
import { ensureUser } from '$lib/server/db/users';
import {
	Locale,
	MessageFlags,
	SlashCommandBuilder,
	type ChatInputCommandInteraction
} from 'discord.js';

const data = new SlashCommandBuilder()
	.setName('attendance')
	.setNameLocalizations({ [Locale.Korean]: '출석', [Locale.Japanese]: '出席' })
	.setDescription('Claim the server’s daily attendance reward.')
	.setDescriptionLocalizations({
		[Locale.Korean]: '서버의 일일 출석 보상을 받습니다.',
		[Locale.Japanese]: 'サーバーのデイリー出席報酬を受け取ります。'
	})
	.addStringOption((option) =>
		option
			.setName('mode')
			.setNameLocalizations({ [Locale.Korean]: '기능', [Locale.Japanese]: '機能' })
			.setDescription('Claim a reward or view the streak ranking.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '출석 보상을 받거나 연속 출석 순위를 확인합니다.',
				[Locale.Japanese]: '出席報酬を受け取るか、連続出席ランキングを表示します。'
			})
			.addChoices(
				{
					name: 'Claim reward',
					name_localizations: { ko: '보상 받기', ja: '報酬を受け取る' },
					value: 'claim'
				},
				{
					name: 'Streak ranking',
					name_localizations: { ko: '연속 출석 순위', ja: '連続出席ランキング' },
					value: 'ranking'
				}
			)
	)
	.setDMPermission(false);

async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guildId) return;
	const language = getLanguage(interaction.locale);
	const mode = interaction.options.getString('mode') || 'claim';
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	if (mode === 'ranking') {
		const leaderboard = await getAttendanceLeaderboard(interaction.guildId);
		const headings = {
			en: '## Attendance streak ranking',
			ko: '## 연속 출석 리더보드',
			ja: '## 連続出席ランキング'
		};
		const lines = leaderboard.map(
			(entry: { rank: number; username: string; currentStreak: number; longestStreak: number }) => {
				const labels = {
					en: `current ${entry.currentStreak}d · best ${entry.longestStreak}d`,
					ko: `현재 ${entry.currentStreak}일 · 최장 ${entry.longestStreak}일`,
					ja: `現在 ${entry.currentStreak}日 · 最長 ${entry.longestStreak}日`
				};
				return `**${entry.rank}.** ${entry.username} — ${labels[language]}`;
			}
		);
		const empty = {
			en: 'No attendance records yet.',
			ko: '아직 출석 기록이 없습니다.',
			ja: '出席記録はまだありません。'
		};
		await interaction.editReply(`${headings[language]}\n${lines.join('\n') || empty[language]}`);
		return;
	}

	await ensureUser(
		interaction.user.id,
		interaction.user.globalName || interaction.user.username,
		interaction.user.displayAvatarURL()
	);

	try {
		const [result, unit] = await Promise.all([
			claimAttendance(interaction.guildId, interaction.user.id),
			getCurrencyUnit(interaction.guildId)
		]);
		const messages = {
			en: `📅 Attendance complete! You received **${formatMoneyDisplay(result.reward)} ${unit}**. Balance: **${formatMoneyDisplay(result.balance)} ${unit}**. Current streak: **${result.currentStreak} days** · Best: **${result.longestStreak} days**.`,
			ko: `📅 출석 완료! **${formatMoneyDisplay(result.reward)} ${unit}**을(를) 받았습니다. 현재 소지금: **${formatMoneyDisplay(result.balance)} ${unit}**. 현재 **${result.currentStreak}일 연속** · 최장 **${result.longestStreak}일**.`,
			ja: `📅 出席完了！ **${formatMoneyDisplay(result.reward)} ${unit}** を受け取りました。残高: **${formatMoneyDisplay(result.balance)} ${unit}**。現在 **${result.currentStreak}日連続** · 最長 **${result.longestStreak}日**。`
		};
		await sendTransactionNotification(
			interaction.guildId,
			`📅 **출석 보상**\n사용자: ${interaction.user}\n지급액: **${formatMoneyDisplay(result.reward)} ${unit}**\n지급 후 잔액: **${formatMoneyDisplay(result.balance)} ${unit}**\n연속 출석: **${result.currentStreak}일** · 최장 **${result.longestStreak}일**`
		);
		await interaction.editReply(messages[language]);
	} catch (error) {
		if (error instanceof AttendanceAlreadyClaimedError) {
			const messages = {
				en: 'You already claimed today’s attendance reward. Try again after midnight in Korea.',
				ko: '오늘은 이미 출석 보상을 받았습니다. 한국 시간 자정 이후에 다시 시도해 주세요.',
				ja: '本日の出席報酬は受け取り済みです。韓国時間の午前0時以降にもう一度お試しください。'
			};
			await interaction.editReply(messages[language]);
			return;
		}
		if (error instanceof AttendanceDisabledError) {
			const messages = {
				en: 'Attendance rewards are disabled on this server.',
				ko: '이 서버는 출석 보상을 사용하지 않습니다.',
				ja: 'このサーバーでは出席報酬が無効です。'
			};
			await interaction.editReply(messages[language]);
			return;
		}
		throw error;
	}
}

export default { data, execute };
