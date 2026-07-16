import { getSessionUser } from '$lib/server/auth';
import { getDB } from '$lib/server/db';
import { setCurrencyUnit, setVisibilitySettings } from '$lib/server/db/guild-settings';
import { canManageGuild } from '$lib/server/db/user-guilds';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, url }) => {
	const user = await getSessionUser(cookies);
	if (!user) redirect(303, '/login');
	const db = getDB();
	const rows = await db`
		SELECT ug.guild_id, ug.guild_name, ug.permissions,
			COALESCE(gs.currency_unit, 'coin') AS currency_unit,
			COALESCE(gs.public_balance_enabled, TRUE) AS public_balance_enabled,
			COALESCE(gs.ranking_enabled, TRUE) AS ranking_enabled
		FROM user_guilds ug
		LEFT JOIN guild_settings gs ON gs.guild_id = ug.guild_id
		WHERE ug.user_id = ${user.id}
		ORDER BY ug.guild_name
	`;
	const guilds = rows
		.filter((row: { permissions: unknown }) => canManageGuild(String(row.permissions)))
		.map(
			(row: {
				guild_id: unknown;
				guild_name: unknown;
				currency_unit: unknown;
				public_balance_enabled: unknown;
				ranking_enabled: unknown;
			}) => ({
				id: String(row.guild_id),
				name: String(row.guild_name),
				currencyUnit: String(row.currency_unit),
				publicBalanceEnabled: Boolean(row.public_balance_enabled),
				rankingEnabled: Boolean(row.ranking_enabled)
			})
		);
	const requested = url.searchParams.get('guild');
	const selectedGuildId = guilds.some((guild: { id: string }) => guild.id === requested)
		? requested
		: guilds[0]?.id || null;
	return { user, guilds, selectedGuildId };
};

export const actions: Actions = {
	settings: async ({ cookies, request }) => {
		const user = await getSessionUser(cookies);
		if (!user) return fail(401, { message: '로그인이 필요합니다.' });
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const unit = String(form.get('unit') || '').trim();
		const db = getDB();
		const rows =
			await db`SELECT permissions FROM user_guilds WHERE user_id=${user.id} AND guild_id=${guildId} LIMIT 1`;
		if (rows.length !== 1 || !canManageGuild(String(rows[0].permissions)))
			return fail(403, { message: '서버 관리 권한이 필요합니다.' });
		if (!unit || unit.length > 16)
			return fail(400, { message: '경제 단위는 1~16자로 입력해 주세요.' });
		await setCurrencyUnit(guildId, unit);
		return { success: true, message: `경제 단위를 ${unit}(으)로 변경했습니다.` };
	},
	visibility: async ({ cookies, request }) => {
		const user = await getSessionUser(cookies);
		if (!user) return fail(401, { message: '로그인이 필요합니다.' });
		const form = await request.formData();
		const guildId = String(form.get('guildId') || '');
		const db = getDB();
		const rows =
			await db`SELECT permissions FROM user_guilds WHERE user_id=${user.id} AND guild_id=${guildId} LIMIT 1`;
		if (rows.length !== 1 || !canManageGuild(String(rows[0].permissions)))
			return fail(403, { message: '서버 관리 권한이 필요합니다.' });
		await setVisibilitySettings(guildId, {
			publicBalanceEnabled: form.get('publicBalanceEnabled') === 'on',
			rankingEnabled: form.get('rankingEnabled') === 'on'
		});
		return { success: true, message: '공개 범위 설정을 저장했습니다.' };
	}
};
