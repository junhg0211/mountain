import { error } from '@sveltejs/kit';
import dotenv from 'dotenv';
import type { PageServerLoad } from './$types';

dotenv.config();

export const load: PageServerLoad = async ({ cookies, url }) => {
	const clientId = process.env.CLIENT_ID;
	if (!clientId) error(500, 'CLIENT_ID is not configured.');

	const state = crypto.randomUUID();
	const redirectUri = process.env.REDIRECT_URI || `${url.origin}/api/login`;

	cookies.set('oauth_state', state, {
		path: '/api/login',
		maxAge: 60 * 10,
		httpOnly: true,
		secure: url.protocol === 'https:',
		sameSite: 'lax'
	});

	return { client_id: clientId, redirect_uri: redirectUri, state };
};
