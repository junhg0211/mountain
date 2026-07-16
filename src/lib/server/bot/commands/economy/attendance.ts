import { getLanguage } from '$lib/server/bot/i18n';
import { sendTransactionNotification } from '$lib/server/bot/notifications';
import {
	AttendanceAlreadyClaimedError,
	AttendanceDisabledError,
	claimAttendance
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
	.setDMPermission(false);

async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guildId) return;
	const language = getLanguage(interaction.locale);
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
			en: `📅 Attendance complete! You received **${result.reward} ${unit}**. Balance: **${result.balance} ${unit}**.`,
			ko: `📅 출석 완료! **${result.reward} ${unit}**을(를) 받았습니다. 현재 소지금: **${result.balance} ${unit}**.`,
			ja: `📅 出席完了！ **${result.reward} ${unit}** を受け取りました。残高: **${result.balance} ${unit}**。`
		};
		await sendTransactionNotification(
			interaction.guildId,
			`📅 **출석 보상**\n사용자: ${interaction.user}\n지급액: **${result.reward} ${unit}**\n지급 후 잔액: **${result.balance} ${unit}**`
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
