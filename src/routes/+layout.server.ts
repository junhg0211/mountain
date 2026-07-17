import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => ({
	discordClientId: process.env.CLIENT_ID || ''
});
