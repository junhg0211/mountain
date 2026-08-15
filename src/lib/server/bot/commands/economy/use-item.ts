import { formatMoneyDisplay } from '$lib/economy/money-display';
import { getLanguage } from '$lib/server/bot/i18n';
import { sendTransactionNotification } from '$lib/server/bot/notifications';
import { getCurrencyUnit } from '$lib/server/db/guild-settings';
import {
	getInventory,
	getItemDefinitionByKey,
	InsufficientItemQuantityError,
	ItemNotFoundError,
	ItemNotUsableError,
	useCurrencyItem
} from '$lib/server/db/items';
import { ensureUser } from '$lib/server/db/users';
import { getGuildMember } from '$lib/server/discord/users';
import {
	Locale,
	MessageFlags,
	SlashCommandBuilder,
	type AutocompleteInteraction,
	type ChatInputCommandInteraction
} from 'discord.js';

const data = new SlashCommandBuilder()
	.setName('use-item')
	.setNameLocalizations({ [Locale.Korean]: '아이템사용', [Locale.Japanese]: 'アイテム使用' })
	.setDescription('Use a currency item from your server inventory.')
	.setDescriptionLocalizations({
		[Locale.Korean]: '이 서버의 인벤토리에서 화폐 아이템을 사용합니다.',
		[Locale.Japanese]: 'このサーバーのインベントリから通貨アイテムを使用します。'
	})
	.addStringOption((option) =>
		option
			.setName('item')
			.setNameLocalizations({ [Locale.Korean]: '아이템', [Locale.Japanese]: 'アイテム' })
			.setDescription('Item key shown by /inventory.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '/inventory에 표시된 아이템 키입니다.',
				[Locale.Japanese]: '/inventory に表示されたアイテムキーです。'
			})
			.setAutocomplete(true)
			.setRequired(true)
	)
	.setDMPermission(false);

async function autocomplete(interaction: AutocompleteInteraction) {
	if (!interaction.guildId) {
		await interaction.respond([]);
		return;
	}
	const member = await getGuildMember(interaction.guildId, interaction.user.id);
	if (!member || member.user.bot) {
		await interaction.respond([]);
		return;
	}
	const query = interaction.options.getFocused().toLocaleLowerCase();
	const inventory = await getInventory(interaction.guildId, interaction.user.id);
	const choices = inventory
		.filter(({ item }) => item.active && item.usable && item.effect?.type === 'currency')
		.filter(({ item }) => `${item.name} ${item.key}`.toLocaleLowerCase().includes(query))
		.slice(0, 25)
		.map(({ item, quantity }) => ({
			name: `${item.iconEmoji} ${item.name} × ${quantity}`.slice(0, 100),
			value: item.key
		}));
	await interaction.respond(choices);
}

async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guildId) return;
	const language = getLanguage(interaction.locale);
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const member = await getGuildMember(interaction.guildId, interaction.user.id);
	if (!member || member.user.bot) {
		const messages = {
			en: 'Only current members of this server can use its items.',
			ko: '현재 이 서버에 참여 중인 사용자만 아이템을 사용할 수 있습니다.',
			ja: '現在このサーバーに参加しているユーザーのみアイテムを使用できます。'
		};
		await interaction.editReply(messages[language]);
		return;
	}

	const itemKey = interaction.options.getString('item', true).trim();
	try {
		await ensureUser(
			interaction.user.id,
			interaction.user.globalName || interaction.user.username,
			interaction.user.displayAvatarURL()
		);
		const item = await getItemDefinitionByKey(interaction.guildId, itemKey);
		const result = await useCurrencyItem(interaction.guildId, interaction.user.id, item.id);
		const unit = await getCurrencyUnit(interaction.guildId);
		const messages = {
			en: `${result.item.iconEmoji} Used **${result.item.name}** and received **${formatMoneyDisplay(result.reward)} ${unit}**. Balance: **${formatMoneyDisplay(result.balance)} ${unit}** · Remaining: **${result.remainingQuantity}**.`,
			ko: `${result.item.iconEmoji} **${result.item.name}**을(를) 사용해 **${formatMoneyDisplay(result.reward)} ${unit}**을(를) 받았습니다. 현재 소지금: **${formatMoneyDisplay(result.balance)} ${unit}** · 남은 수량: **${result.remainingQuantity}개**.`,
			ja: `${result.item.iconEmoji} **${result.item.name}** を使用し、**${formatMoneyDisplay(result.reward)} ${unit}** を受け取りました。残高: **${formatMoneyDisplay(result.balance)} ${unit}** · 残り: **${result.remainingQuantity}個**。`
		};
		await sendTransactionNotification(
			interaction.guildId,
			`${result.item.iconEmoji} **아이템 사용**\n사용자: <@${interaction.user.id}>\n아이템: **${result.item.name}**\n보상: **${formatMoneyDisplay(result.reward)} ${unit}**\n사용 후 잔액: **${formatMoneyDisplay(result.balance)} ${unit}**`
		);
		await interaction.editReply(messages[language]);
	} catch (error) {
		const errors = {
			notFound: {
				en: 'That item does not exist on this server.',
				ko: '이 서버에 존재하지 않는 아이템입니다.',
				ja: 'このサーバーには存在しないアイテムです。'
			},
			notUsable: {
				en: 'That item cannot currently be used as a currency item.',
				ko: '현재 화폐 아이템으로 사용할 수 없는 아이템입니다.',
				ja: '現在、通貨アイテムとして使用できないアイテムです。'
			},
			insufficient: {
				en: 'You do not own that item on this server.',
				ko: '이 서버에서 해당 아이템을 보유하고 있지 않습니다.',
				ja: 'このサーバーでそのアイテムを所持していません。'
			}
		};
		if (error instanceof ItemNotFoundError) await interaction.editReply(errors.notFound[language]);
		else if (error instanceof ItemNotUsableError)
			await interaction.editReply(errors.notUsable[language]);
		else if (error instanceof InsufficientItemQuantityError)
			await interaction.editReply(errors.insufficient[language]);
		else throw error;
	}
}

export default { data, execute, autocomplete };
