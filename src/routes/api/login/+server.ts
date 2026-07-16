import { createSession } from '$lib/server/auth';
import { ensureUser } from '$lib/server/db/users';
import { syncUserGuilds } from '$lib/server/db/user-guilds';
import { getGuilds, getMe } from '$lib/server/discord/users';
import { error, redirect, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ cookies, fetch, request }) => {
	const url = new URL(request.url);
	const query = url.searchParams;
	const code = query.get('code');
	const state = query.get('state');
	const expectedState = cookies.get('oauth_state');
	cookies.delete('oauth_state', { path: '/api/login' });

	if (!code) error(400, 'Discord authorization code is missing.');
	if (!state || !expectedState || state !== expectedState) error(400, 'Invalid OAuth state.');

	const clientId = process.env.CLIENT_ID;
	const clientSecret = process.env.CLIENT_SECRET;
	const redirectUri = process.env.REDIRECT_URI || `${url.origin}/api/login`;
	if (!clientId || !clientSecret) error(500, 'Discord OAuth is not configured.');

	const response = await fetch(`https://discord.com/api/v10/oauth2/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri,
			client_id: clientId,
			client_secret: clientSecret
		})
	});

	if (!response.ok) error(502, `Discord token exchange failed (${response.status}).`);
	const data = (await response.json()) as { access_token?: string };
	if (!data.access_token) error(502, 'Discord did not return an access token.');

	const [me, guilds] = await Promise.all([getMe(data.access_token), getGuilds(data.access_token)]);
	await ensureUser(me.id, me.global_name || me.username, me.avatar || '');
	await syncUserGuilds(me.id, guilds);
	await createSession(cookies, me.id, url.protocol === 'https:');

	return redirect(303, '/');
};
