import {
	ActionRowBuilder,
	AttachmentBuilder,
	InteractionContextType,
	Locale,
	MessageFlags,
	ModalBuilder,
	SlashCommandBuilder,
	TextInputBuilder,
	TextInputStyle,
	type ChatInputCommandInteraction,
	type ModalSubmitInteraction
} from 'discord.js';
import { transform, TokucryptError } from '../../../tokucrypt';

const data = new SlashCommandBuilder()
	.setName('crypt')
	.setNameLocalizations({ [Locale.Korean]: '암호', [Locale.Japanese]: '暗号' })
	.setDescription('Encrypt or decrypt text with TOKUCRYPT.')
	.setDescriptionLocalizations({
		[Locale.Korean]: 'TOKUCRYPT로 문자열을 암호화하거나 복호화합니다.',
		[Locale.Japanese]: 'TOKUCRYPTで文字列を暗号化・復号します。'
	})
	.setContexts(InteractionContextType.Guild);
for (const [name, ko, ja, description, descriptionKo, descriptionJa] of [
	[
		'encrypt',
		'암호화',
		'暗号化',
		'Encrypt text.',
		'문자열을 암호화합니다.',
		'文字列を暗号化します。'
	],
	['decrypt', '복호화', '復号', 'Decrypt text.', '문자열을 복호화합니다.', '文字列を復号します。']
])
	data.addSubcommand((sub) =>
		sub
			.setName(name)
			.setNameLocalizations({ [Locale.Korean]: ko, [Locale.Japanese]: ja })
			.setDescription(description)
			.setDescriptionLocalizations({
				[Locale.Korean]: descriptionKo,
				[Locale.Japanese]: descriptionJa
			})
	);

async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.inGuild()) {
		await interaction.reply({
			content: '서버에서만 사용할 수 있습니다.',
			flags: MessageFlags.Ephemeral
		});
		return;
	}
	const mode = interaction.options.getSubcommand();
	const modal = new ModalBuilder()
		.setCustomId(`tokucrypt:${mode}`)
		.setTitle(mode === 'encrypt' ? 'TOKUCRYPT 암호화' : 'TOKUCRYPT 복호화');
	modal.addComponents(
		new ActionRowBuilder<TextInputBuilder>().addComponents(
			new TextInputBuilder()
				.setCustomId('text')
				.setLabel(mode === 'encrypt' ? '내용 (UTF-8 최대 2,800바이트)' : '암호문')
				.setStyle(TextInputStyle.Paragraph)
				.setRequired(true)
				.setMaxLength(mode === 'encrypt' ? 2800 : 4000)
		),
		new ActionRowBuilder<TextInputBuilder>().addComponents(
			new TextInputBuilder()
				.setCustomId('password')
				.setLabel('비밀번호 (화면에 표시됩니다)')
				.setStyle(TextInputStyle.Short)
				.setRequired(true)
				.setMaxLength(256)
		)
	);
	await interaction.showModal(modal);
}
export async function handleCryptModal(interaction: ModalSubmitInteraction): Promise<boolean> {
	if (!interaction.customId.startsWith('tokucrypt:')) return false;
	// Never let exceptions carrying interaction fields reach the shared logging handler.
	try {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const mode = interaction.customId.slice(10);
		if (
			!interaction.guildId ||
			!interaction.inGuild() ||
			(mode !== 'encrypt' && mode !== 'decrypt')
		) {
			await interaction.editReply('서버에서만 사용할 수 있습니다.');
			return true;
		}
		// A fresh REST lookup verifies membership rather than trusting modal fields.
		const guild = await interaction.client.guilds.fetch(interaction.guildId);
		await guild.members.fetch({ user: interaction.user.id, force: true });
		const output = await transform(
			mode,
			interaction.guildId,
			interaction.user.id,
			interaction.fields.getTextInputValue('text'),
			interaction.fields.getTextInputValue('password')
		);
		const title = mode === 'encrypt' ? '🔒 **암호화 완료**' : '🔓 **복호화 완료**';
		const note =
			mode === 'encrypt'
				? '\n복호화하려면 `/암호 복호화`를 사용하세요. 비밀번호는 별도로 보관하세요.'
				: '\n암호화된 문자열이 성공적으로 복원되었습니다.';
		const content = `${title}\n\n${mode === 'encrypt' ? '암호문' : '원문'}:\n${output}${note}`;
		await interaction.editReply(
			content.length <= 2000
				? { content, allowedMentions: { parse: [] } }
				: {
						content: title + note,
						files: [
							new AttachmentBuilder(Buffer.from(output, 'utf8'), {
								name: mode === 'encrypt' ? 'tokucrypt.txt' : 'plaintext.txt'
							})
						],
						allowedMentions: { parse: [] }
					}
		);
	} catch (error) {
		const messages = {
			auth: '❌ **복호화 실패**\n암호문 또는 비밀번호가 올바르지 않습니다.',
			format: '암호문 형식이 올바르지 않습니다.',
			version: '지원하지 않는 암호문 버전입니다.',
			config: '서버 암호화 설정 오류입니다. 관리자에게 문의하세요.',
			limit: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
			input: '내용과 비밀번호를 입력하고 입력 길이 제한을 확인하세요.'
		};
		const content =
			error instanceof TokucryptError
				? messages[error.code]
				: '요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.';
		try {
			if (interaction.deferred || interaction.replied)
				await interaction.editReply({ content, files: [] });
			else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
		} catch {
			/* No payloads or secrets are logged, including failed Discord replies. */
		}
	}
	return true;
}
export default { data, execute };
