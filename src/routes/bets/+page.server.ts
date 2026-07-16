import { getSessionUser } from '$lib/server/auth';
import { sendTransactionNotification } from '$lib/server/bot/notifications';
import { getDB } from '$lib/server/db';
import { createTeamBettingPool, getBettingPools } from '$lib/server/db/betting';
import { canManageGuild } from '$lib/server/db/user-guilds';
import { publishBettingUpdate } from '$lib/server/realtime';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

interface GuildRow {
	guild_id: unknown;
	guild_name: unknown;
	icon_hash: unknown;
	permissions: unknown;
}

export const load: PageServerLoad = async ({ cookies, url }) => {
	const user = await getSessionUser(cookies);
	if (!user) redirect(303, '/login');
	const db = await getDB();
	const rows = await db`
		SELECT guild_id, guild_name, icon_hash, permissions
		FROM user_guilds WHERE user_id=${user.id} ORDER BY guild_name
	`;
	const guilds = rows.map((row: GuildRow) => ({
		id: String(row.guild_id),
		name: String(row.guild_name),
		iconUrl: row.icon_hash
			? `https://cdn.discordapp.com/icons/${row.guild_id}/${row.icon_hash}.png`
			: null,
		canManage: canManageGuild(String(row.permissions))
	}));
	const requested = url.searchParams.get('guild');
	const selectedGuildId = guilds.some((guild: { id: string }) => guild.id === requested)
		? requested
		: guilds[0]?.id || null;
	return {
		user,
		guilds,
		selectedGuildId,
		pools: selectedGuildId ? await getBettingPools(selectedGuildId, 50) : []
	};
};

export const actions: Actions = {
	create: async ({ cookies, request }) => {
		const user = await getSessionUser(cookies);
		if (!user) return fail(401, { message: '로그인이 필요합니다.' });
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const title = String(form.get('title') || '').trim();
		const db = await getDB();
		const membership = await db`
			SELECT 1 FROM user_guilds WHERE user_id=${user.id} AND guild_id=${guildId} LIMIT 1
		`;
		if (membership.length !== 1) return fail(403, { message: '서버 접근 권한이 없습니다.' });
		if (!title || title.length > 80)
			return fail(400, { message: '베팅 판 제목은 1~80자로 입력해 주세요.' });
		const poolId = await createTeamBettingPool(guildId, user.id, title);
		publishBettingUpdate(guildId, poolId);
		await sendTransactionNotification(
			guildId,
			`🎲 **베팅 판 생성**\n#${poolId} ${title}\n판 주인: <@${user.id}>`
		);
		redirect(303, `/bets/${poolId}?guild=${encodeURIComponent(guildId)}`);
	}
};
