import { getLanguage } from '$lib/server/bot/i18n';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Locale,
	MessageFlags,
	SlashCommandBuilder,
	type ChatInputCommandInteraction
} from 'discord.js';

const data = new SlashCommandBuilder()
	.setName('dashboard')
	.setNameLocalizations({ [Locale.Korean]: '대시보드', [Locale.Japanese]: 'ダッシュボード' })
	.setDescription('Open the Mountain web dashboard.')
	.setDescriptionLocalizations({
		[Locale.Korean]: 'Mountain 웹 대시보드를 엽니다.',
		[Locale.Japanese]: 'Mountainのウェブダッシュボードを開きます。'
	});

function getDashboardUrl(): string | null {
	const configured = process.env.DASHBOARD_URL?.trim();
	const fallback = process.env.REDIRECT_URI?.trim();
	const value = configured || fallback;
	if (!value) return null;

	try {
		const url = new URL(value);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		return configured ? url.toString() : url.origin;
	} catch {
		return null;
	}
}

async function execute(interaction: ChatInputCommandInteraction) {
	const language = getLanguage(interaction.locale);
	const url = getDashboardUrl();
	if (!url) {
		const errors = {
			en: 'The dashboard URL is not configured.',
			ko: '대시보드 URL이 설정되지 않았습니다.',
			ja: 'ダッシュボードURLが設定されていません。'
		};
		await interaction.reply({ content: errors[language], flags: MessageFlags.Ephemeral });
		return;
	}

	const messages = {
		en: { content: 'Manage your server economy from the web dashboard.', button: 'Open dashboard' },
		ko: { content: '웹 대시보드에서 서버 경제를 관리해 보세요.', button: '대시보드 열기' },
		ja: {
			content: 'ウェブダッシュボードでサーバー経済を管理できます。',
			button: 'ダッシュボードを開く'
		}
	};
	const message = messages[language];
	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setLabel(message.button).setStyle(ButtonStyle.Link).setURL(url)
	);

	await interaction.reply({
		content: message.content,
		components: [row],
		flags: MessageFlags.Ephemeral
	});
}

export default { data, execute };
