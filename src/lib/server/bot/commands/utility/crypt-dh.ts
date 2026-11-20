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
import { DhError, GROUP_ID, generatePair, sharedKey, limitDh } from '../../../tokucrypt/dh';

export function addDhCommands(data: SlashCommandBuilder) {
	for (const [name, ko, ja, en, descriptionKo, descriptionJa] of [
		[
			'keypair',
			'키쌍생성',
			'鍵ペア生成',
			'Generate a private DH key and public key.',
			'DH 비밀키와 공개키를 생성합니다.',
			'DH秘密鍵と公開鍵を生成します。'
		],
		[
			'shared',
			'공유키생성',
			'共有鍵生成',
			'Derive a shared password from a peer public key.',
			'상대방 공개키로 공유 암호키를 생성합니다.',
			'相手の公開鍵から共有パスワードを導出します。'
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
		);
}
async function failure(
	interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
	error: unknown
) {
	const messages = {
		public: '상대방의 공개키가 유효하지 않습니다.',
		format: '입력한 키의 형식을 확인하세요.',
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
	if (!['keypair', 'shared'].includes(mode)) return false;
	try {
		if (mode === 'shared') {
			const modal = new ModalBuilder().setCustomId('mountain-dh:shared').setTitle('DH 공유키 생성');
			for (const [id, label, max] of [
				['private', '자신의 비밀키 (43자, 화면에 표시됩니다)', 43],
				['peer', '상대방의 공개키 (43자)', 43]
			] as const) {
				const input = new TextInputBuilder()
					.setCustomId(id)
					.setLabel(label)
					.setStyle(TextInputStyle.Short)
					.setMinLength(max)
					.setMaxLength(max)
					.setRequired(true);
				modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
			}
			await interaction.showModal(modal);
			return true;
		}
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		await member(interaction);
		limitDh(interaction.user.id);
		const pair = generatePair();
		await interaction.editReply({
			content: `🔐 키쌍 생성 완료\n그룹: ${GROUP_ID}\n비밀키:\n\`\`\`\n${pair.privateKey}\n\`\`\`\n공개키:\n\`\`\`\n${pair.publicKey}\n\`\`\`\n⚠️ 비밀키는 공개하지 마세요. 공개키 43자 전체만 상대방에게 전달하세요. 공유키생성에는 자신의 비밀키와 상대방 공개키를 입력하세요.`,
			allowedMentions: { parse: [] }
		});
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
		const result = sharedKey(guild, field('private'), field('peer'));
		await interaction.editReply({
			content: `🔓 공유키 생성 완료\n공유 암호키:\n\`\`\`\n${result.key}\n\`\`\`\n기존 /암호 암호화 및 /암호 복호화의 비밀번호로 사용하세요.\n\n키 교환 확인값:\n\`${result.fingerprint}\`\n상대방과 확인값을 신뢰할 수 있는 경로로 비교하세요. 공개키는 발신자 인증을 포함하지 않습니다. 확인값 비교 없이 상대방을 신뢰하지 마세요. 복호화한 Discord ID도 상대방이 주장한 정보입니다.`,
			allowedMentions: { parse: [] }
		});
	} catch (error) {
		await failure(interaction, error);
	}
	return true;
}
