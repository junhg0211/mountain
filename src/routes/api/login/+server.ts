import { getMe } from '$lib/server/discord/users';
import { json, redirect, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ cookies, fetch, request }) => {
	const query = new URL(request.url).searchParams;
	const code = query.get('code');

	const data = await fetch(`https://discord.com/api/v10/oauth2/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code: code || '',
			redirect_uri: process.env.REDIRECT_URI || '',
			client_id: process.env.CLIENT_ID || '',
			client_secret: process.env.CLIENT_SECRET || ''
		})
	})
		.then((res) => res.json())
		.then((data) => {
			return data;
		})
		.catch((error) => {
			json({ error: 'Failed to exchange code for token', details: error }, { status: 500 });
		});

	cookies.set('token', data.access_token, {
		path: '/',
		maxAge: 60 * 60 * 24 * 7, // 1 week
		httpOnly: true,
		secure: request.url.startsWith('https://'),
		sameSite: 'lax'
	});

	console.log(data);
	const me = await getMe(data.access_token);
	console.log(JSON.stringify(me));

	return redirect(308, '/');
};
