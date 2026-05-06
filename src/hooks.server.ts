import { plugin } from '$lib/server/bot';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	return response;
};

if (typeof window === 'undefined') {
	plugin.configureServer();
}
