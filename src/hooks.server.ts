import { startBot } from '$lib/server/bot';
import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';

let botStartupRequested = false;

export const handle: Handle = async ({ event, resolve }) => {
	if (dev && !botStartupRequested) {
		botStartupRequested = true;
		void startBot().catch((error) => console.error('Discord bot startup failed:', error));
	}

	return resolve(event);
};
