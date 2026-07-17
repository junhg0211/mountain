import { createSession, deleteSession } from '$lib/server/auth';
import { ensureUser } from '$lib/server/db/users';
import { syncUserGuilds } from '$lib/server/db/user-guilds';
import { getBotGuildIds, getGuilds, getMe } from '$lib/server/discord/users';
import { json, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ cookies, request }) => {
	const clientId = process.env.CLIENT_ID;
	const clientSecret = process.env.CLIENT_SECRET;
	if (!clientId || !clientSecret)
		return json({ message: 'Discord OAuth가 설정되지 않았습니다.' }, { status: 500 });

	let code: string;
	try {
		const body = (await request.json()) as { code?: unknown };
		code = typeof body.code === 'string' ? body.code.trim() : '';
	} catch {
		return json({ message: '올바른 인증 요청이 아닙니다.' }, { status: 400 });
	}
	if (!code || code.length > 512)
		return json({ message: 'Discord 인증 코드가 없습니다.' }, { status: 400 });

	const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: 'authorization_code',
			code
		})
	});
	if (!tokenResponse.ok)
		return json(
			{ message: `Discord 토큰 교환에 실패했습니다 (${tokenResponse.status}).` },
			{ status: 502 }
		);
	const token = (await tokenResponse.json()) as { access_token?: string };
	if (!token.access_token)
		return json({ message: 'Discord가 접근 토큰을 반환하지 않았습니다.' }, { status: 502 });

	const [me, guilds, botGuildIds] = await Promise.all([
		getMe(token.access_token),
		getGuilds(token.access_token),
		getBotGuildIds()
	]);
	await ensureUser(me.id, me.global_name || me.username, me.avatar || '');
	await syncUserGuilds(
		me.id,
		guilds.filter((guild) => botGuildIds.has(guild.id))
	);
	await deleteSession(cookies);
	await createSession(cookies, me.id, true, true);

	return json(
		{ access_token: token.access_token },
		{ headers: { 'Cache-Control': 'no-store, private' } }
	);
};
