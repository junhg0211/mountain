import { addGuildMemberRole, removeGuildMemberRole } from '$lib/server/discord/users';
import { cancelRoleSubscription, getUserAutomaticPayments, listRolePlans, subscribeRole } from '$lib/server/db/automatic-payments';
import { getLanguage } from '$lib/server/bot/i18n';
import { InsufficientBalanceError } from '$lib/server/db/accounts';
import { ensureUser } from '$lib/server/db/users';
import { sendTransactionNotification } from '$lib/server/bot/notifications';
import { Locale, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

const data = new SlashCommandBuilder()
	.setName('subscription').setNameLocalizations({ [Locale.Korean]: '구독', [Locale.Japanese]: 'サブスク' })
	.setDescription('Manage monthly role subscriptions.').setDescriptionLocalizations({ [Locale.Korean]: '월간 역할 구독을 관리합니다.', [Locale.Japanese]: '月額ロール購読を管理します。' }).setDMPermission(false)
	.addSubcommand((s) => s.setName('list').setNameLocalizations({ [Locale.Korean]: '목록', [Locale.Japanese]: '一覧' }).setDescription('List role plans.').setDescriptionLocalizations({ [Locale.Korean]: '역할 상품과 내 구독을 봅니다.', [Locale.Japanese]: 'ロール商品と購読を表示します。' }))
	.addSubcommand((s) => s.setName('join').setNameLocalizations({ [Locale.Korean]: '가입', [Locale.Japanese]: '加入' }).setDescription('Subscribe and pay immediately.').setDescriptionLocalizations({ [Locale.Korean]: '즉시 결제하고 역할을 구독합니다.', [Locale.Japanese]: '即時決済して購読します。' }).addStringOption((o) => o.setName('plan').setNameLocalizations({ [Locale.Korean]: '상품번호', [Locale.Japanese]: '商品番号' }).setDescription('Plan ID shown in the list.').setRequired(true)))
	.addSubcommand((s) => s.setName('cancel').setNameLocalizations({ [Locale.Korean]: '해지', [Locale.Japanese]: '解除' }).setDescription('Cancel a role subscription.').setDescriptionLocalizations({ [Locale.Korean]: '역할 구독을 해지합니다.', [Locale.Japanese]: 'ロール購読を解除します。' }).addStringOption((o) => o.setName('id').setDescription('Subscription ID shown in the list.').setRequired(true)));

async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guildId) return;
	const lang = getLanguage(interaction.locale), sub = interaction.options.getSubcommand();
	const text = {
		warning: { en: 'Joining charges the full monthly price now. Renewals run on the 1st at 12:00 KST. No proration or refunds.', ko: '가입 즉시 한 달 요금 전액이 결제됩니다. 이후 매월 1일 12:00(KST)에 결제되며 일할 계산과 환불은 없습니다.', ja: '加入時に月額全額を決済します。以後、毎月1日12:00(KST)に決済され、日割り・返金はありません。' },
		joined: { en: 'Subscription activated.', ko: '구독 결제 후 역할을 지급했습니다.', ja: '購読決済後、ロールを付与しました。' },
		cancelled: { en: 'Subscription cancelled and role removed.', ko: '구독을 해지하고 역할을 회수했습니다.', ja: '購読を解除し、ロールを回収しました。' },
		insufficient: { en: 'Insufficient balance.', ko: '소지금이 부족합니다.', ja: '残高が不足しています。' }
	};
	if (sub === 'list') {
		const [plans, mine] = await Promise.all([listRolePlans(interaction.guildId), getUserAutomaticPayments(interaction.guildId, interaction.user.id)]);
		const planLines = plans.map((p: { id: string; roleId: string; monthlyPrice: string }) => `상품 #${p.id} · <@&${p.roleId}> · ${p.monthlyPrice}`);
		const mineLines = mine.subscriptions.map((s: { id: string; name: string; status: string }) => `구독 #${s.id} · ${s.name} · ${s.status}`);
		await interaction.reply({ content: [text.warning[lang], '', ...planLines, '', ...mineLines].join('\n').slice(0, 2000), flags: MessageFlags.Ephemeral }); return;
	}
	if (sub === 'join') {
		const planId = interaction.options.getString('plan', true), plan = (await listRolePlans(interaction.guildId)).find((p: { id: string }) => p.id === planId);
		if (!plan) throw new Error('ROLE_PLAN_NOT_FOUND');
		try {
			await ensureUser(interaction.user.id, interaction.user.globalName || interaction.user.username, interaction.user.displayAvatarURL());
			await addGuildMemberRole(interaction.guildId, interaction.user.id, plan.roleId);
			const payment = await subscribeRole(interaction.guildId, interaction.user.id, planId);
			await sendTransactionNotification(interaction.guildId, `🎨 **역할 구독 가입**\n사용자: <@${interaction.user.id}>\n역할: <@&${plan.roleId}>\n금액: **${payment.price}**`);
			await interaction.reply({ content: `${text.joined[lang]}\n${text.warning[lang]}`, flags: MessageFlags.Ephemeral });
		} catch (error) {
			await removeGuildMemberRole(interaction.guildId, interaction.user.id, plan.roleId).catch(() => undefined);
			if (error instanceof InsufficientBalanceError) { await interaction.reply({ content: text.insufficient[lang], flags: MessageFlags.Ephemeral }); return; }
			throw error;
		}
		return;
	}
	const id = interaction.options.getString('id', true), mine = await getUserAutomaticPayments(interaction.guildId, interaction.user.id);
	const subscription = mine.subscriptions.find((s: { id: string }) => s.id === id);
	if (!subscription) throw new Error('SUBSCRIPTION_NOT_FOUND');
	await cancelRoleSubscription(interaction.guildId, interaction.user.id, id);
	await removeGuildMemberRole(interaction.guildId, interaction.user.id, subscription.roleId).catch(console.error);
	await interaction.reply({ content: text.cancelled[lang], flags: MessageFlags.Ephemeral });
}

export default { data, execute };
