import { getSessionUser } from '$lib/server/auth';
import { getDB } from '$lib/server/db';
import { getMemberActivityRanking, koreanActivityDate } from '$lib/server/db/member-activity';
import { canManageGuild } from '$lib/server/db/user-guilds';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function daysBefore(date: string, days: number) {
	const value = new Date(`${date}T12:00:00+09:00`);
	value.setUTCDate(value.getUTCDate() - days);
	return koreanActivityDate(value);
}

export const load: PageServerLoad = async ({ cookies, url }) => {
	const user = await getSessionUser(cookies);
	if (!user) redirect(303, '/login');
	const db = await getDB();
	const rows = await db`
		SELECT guild_id, guild_name, permissions
		FROM user_guilds
		WHERE user_id=${user.id}
		ORDER BY guild_name
	`;
	const guilds = rows
		.filter((row: { permissions: unknown }) => canManageGuild(String(row.permissions)))
		.map((row: { guild_id: unknown; guild_name: unknown }) => ({
			id: String(row.guild_id),
			name: String(row.guild_name)
		}));
	const requestedGuildId = url.searchParams.get('guild');
	const selectedGuildId = guilds.some((guild: { id: string }) => guild.id === requestedGuildId)
		? requestedGuildId
		: guilds[0]?.id || null;
	const today = koreanActivityDate();
	let startDate = DATE_PATTERN.test(url.searchParams.get('start') || '')
		? url.searchParams.get('start')!
		: daysBefore(today, 29);
	let endDate = DATE_PATTERN.test(url.searchParams.get('end') || '')
		? url.searchParams.get('end')!
		: today;
	if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
	const ranking = selectedGuildId
		? await getMemberActivityRanking(selectedGuildId, startDate, endDate)
		: [];

	return { user, guilds, selectedGuildId, startDate, endDate, ranking };
};
