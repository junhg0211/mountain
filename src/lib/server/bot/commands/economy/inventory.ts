import { getLanguage } from '$lib/server/bot/i18n';
import { getInventory } from '$lib/server/db/items';
import { getGuildMember } from '$lib/server/discord/users';
import {
	Locale,
	MessageFlags,
	SlashCommandBuilder,
	type ChatInputCommandInteraction
} from 'discord.js';

const data = new SlashCommandBuilder()
	.setName('inventory')
	.setNameLocalizations({ [Locale.Korean]: '인벤토리', [Locale.Japanese]: 'インベントリ' })
	.setDescription('View the items in your server inventory.')
	.setDescriptionLocalizations({
		[Locale.Korean]: '이 서버에서 보유한 아이템을 확인합니다.',
		[Locale.Japanese]: 'このサーバーで所持しているアイテムを確認します。'
	})
	.setDMPermission(false);

async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guildId) return;
	const language = getLanguage(interaction.locale);
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const member = await getGuildMember(interaction.guildId, interaction.user.id);
	if (!member || member.user.bot) {
		const messages = {
			en: 'Only current members of this server can view its inventory.',
			ko: '현재 이 서버에 참여 중인 사용자만 인벤토리를 확인할 수 있습니다.',
			ja: '現在このサーバーに参加しているユーザーのみインベントリを確認できます。'
		};
		await interaction.editReply(messages[language]);
		return;
	}

	const inventory = await getInventory(interaction.guildId, interaction.user.id);
	if (inventory.length === 0) {
		const messages = {
			en: 'Your inventory is empty on this server.',
			ko: '이 서버에서 보유한 아이템이 없습니다.',
			ja: 'このサーバーで所持しているアイテムはありません。'
		};
		await interaction.editReply(messages[language]);
		return;
	}

	const headings = {
		en: '## Your inventory',
		ko: '## 내 인벤토리',
		ja: '## マイインベントリ'
	};
	const useHints = {
		en: 'Use `/use-item item:<key>` for usable currency items.',
		ko: '사용 가능한 화폐 아이템은 `/use-item item:<키>`로 사용할 수 있습니다.',
		ja: '使用可能な通貨アイテムは `/use-item item:<キー>` で使用できます。'
	};
	const lines = inventory.map(({ item, quantity }) => {
		const usable = item.active && item.usable && item.effect?.type === 'currency';
		const marker = usable ? ' · ✓' : '';
		return `${item.iconEmoji} **${item.name}** × ${quantity} · \`${item.key}\`${marker}`;
	});
	await interaction.editReply(
		[headings[language], ...lines, '', useHints[language]].join('\n').slice(0, 2_000)
	);
}

export default { data, execute };
