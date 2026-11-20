import {
	ActionRowBuilder,
	Locale,
	MessageFlags,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	type ChatInputCommandInteraction,
	type ModalSubmitInteraction,
	type SlashCommandBuilder
} from 'discord.js';
import { DhError, GROUP_ID, P, generatePair, sharedKey, limitDh } from '../../../tokucrypt/dh';

export function addDhCommands(data: SlashCommandBuilder) {
	for (const [name, ko, ja, en, descriptionKo, descriptionJa] of [
		[
			'parameters',
			'매개변수생성',
			'パラメータ生成',
			'Show the standard DH parameters.',
			'표준 DH 공개 매개변수를 확인합니다.',
			'標準DH公開パラメータを表示します。'
		],
		[
			'keypair',
			'키쌍생성',
			'鍵ペア生成',
			'Generate a private DH key and signed public key.',
			'DH 비밀키와 서명된 공개키를 생성합니다.',
			'DH秘密鍵と署名付き公開鍵を生成します。'
		],
		[
			'shared',
			'공유키생성',
			'共有鍵生成',
			'Derive a shared password from signed public keys.',
			'서명된 공개키로 공유 암호키를 생성합니다.',
			'署名付き公開鍵から共有パスワードを導出します。'
		]
	])
		data.addSubcommand((sub) =>
			sub
				.setName(name)
				.setNameLocalizations({ [Locale.Korean]: ko, [Locale.Japanese]: ja })
				.setDescription(en)
				.setDescriptionLocalizations({
					[Locale.Korean]: descriptionKo,
					[Locale.Japanese]: descriptionJa
				})
				.addStringOption((option) =>
					option
						.setName('group_id')
						.setDescription('Standard DH group (default: ffdhe2048).')
						.setDescriptionLocalizations({
							[Locale.Korean]: '표준 DH 그룹 (기본: ffdhe2048).',
							[Locale.Japanese]: '標準DHグループ（既定: ffdhe2048）。'
						})
						.addChoices({ name: GROUP_ID, value: GROUP_ID })
				)
		);
}
async function failure(
	interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
	error: unknown
) {
	const messages = {
		group: '지원되지 않는 DH 그룹입니다.',
		private: '비밀키가 허용 범위를 벗어났습니다.',
		public: '상대방 또는 자신의 공개키가 유효하지 않거나 만료되었습니다.',
		format: '입력한 키의 형식을 확인하세요.',
		config: '서버 DH 서명 키 설정이 필요합니다. 관리자에게 문의하세요.',
		limit: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.'
	};
	const content =
		error instanceof DhError ? messages[error.code] : '키 생성에 실패했습니다. 다시 시도하세요.';
	try {
		if (interaction.deferred || interaction.replied)
			await interaction.editReply({ content, files: [] });
		else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
	} catch {
		/* Never forward secret-bearing Discord errors to the shared logger. */
	}
}
async function member(interaction: ChatInputCommandInteraction | ModalSubmitInteraction) {
	if (!interaction.guildId || !interaction.inGuild()) throw new Error('guild');
	const guild = await interaction.client.guilds.fetch(interaction.guildId);
	await guild.members.fetch({ user: interaction.user.id, force: true });
	return interaction.guildId;
}
export async function executeDh(interaction: ChatInputCommandInteraction): Promise<boolean> {
	const mode = interaction.options.getSubcommand();
	if (!['parameters', 'keypair', 'shared'].includes(mode)) return false;
	try {
		if (mode === 'shared') {
			const modal = new ModalBuilder().setCustomId('mountain-dh:shared').setTitle('DH 공유키 생성');
			for (const [id, label, max] of [
				['group', '그룹 (ffdhe2048)', 32],
				['private', '자신의 비밀키 (화면에 표시됩니다)', 617],
				['own', '자신의 서명된 공개키 (DH1.…)', 1400],
				['peer', '상대방의 서명된 공개키 (DH1.…)', 1400]
			] as const) {
				const input = new TextInputBuilder()
					.setCustomId(id)
					.setLabel(label)
					.setStyle(TextInputStyle.Paragraph)
					.setMaxLength(max)
					.setRequired(true);
				if (id === 'group') input.setValue(interaction.options.getString('group_id') ?? GROUP_ID);
				modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
			}
			await interaction.showModal(modal);
			return true;
		}
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const guild = await member(interaction);
		limitDh(interaction.user.id);
		if (mode === 'parameters') {
			await interaction.editReply(
				`🔑 Diffie–Hellman 매개변수\n그룹: ${GROUP_ID}\ng: 2\np (10진수): ${P}\n\n공개해도 안전합니다. 키쌍생성에서 같은 group_id를 사용하세요.`
			);
		} else {
			const pair = generatePair(
				interaction.options.getString('group_id') ?? GROUP_ID,
				guild,
				interaction.user.id
			);
			await interaction.editReply({
				content: `🔐 키쌍 생성 완료\n그룹: ${GROUP_ID}\n비밀키:\n\`\`\`\n${pair.privateKey}\n\`\`\`\n서명된 공개키 (24시간 유효):\n\`\`\`\n${pair.token}\n\`\`\`\n⚠️ 비밀키는 공개하지 마세요. DH1.으로 시작하는 공개키 전체만 상대방에게 전달하세요. 공유키생성에는 자신의 공개키도 필요합니다.`,
				allowedMentions: { parse: [] }
			});
		}
	} catch (error) {
		await failure(interaction, error);
	}
	return true;
}
export async function handleDhModal(interaction: ModalSubmitInteraction): Promise<boolean> {
	if (!interaction.customId.startsWith('mountain-dh:')) return false;
	try {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const guild = await member(interaction);
		limitDh(interaction.user.id);
		const field = (id: string) => interaction.fields.getTextInputValue(id);
		const result = sharedKey(
			field('group'),
			guild,
			interaction.user.id,
			field('private'),
			field('own'),
			field('peer')
		);
		await interaction.editReply({
			content: `🔓 공유키 생성 완료\n공유 암호키:\n\`\`\`\n${result.key}\n\`\`\`\n기존 /암호 암호화 및 /암호 복호화의 비밀번호로 사용하세요.\n\n키 교환 확인값:\n\`${result.fingerprint}\`\n상대방과 확인값을 신뢰할 수 있는 경로로 비교하세요. 서명은 봇이 발급한 키임을 확인하며, 익명 게시자의 신원을 증명하지 않습니다. 복호화한 Discord ID도 상대방이 주장한 정보입니다.`,
			allowedMentions: { parse: [] }
		});
	} catch (error) {
		await failure(interaction, error);
	}
	return true;
}
