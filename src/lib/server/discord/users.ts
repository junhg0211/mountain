const API_BASE_URL = 'https://discord.com/api/v10';

export interface DiscordUser {
	id: string;
	username: string;
	global_name: string | null;
	avatar: string | null;
}

export interface DiscordGuild {
	id: string;
	name: string;
	icon: string | null;
	permissions: string;
}

export async function getMe(token: string): Promise<DiscordUser> {
	if (!token) throw new Error('Discord access token is missing.');

	const response = await fetch(`${API_BASE_URL}/users/@me`, {
		headers: {
			Authorization: `Bearer ${token}`
		}
	});

	if (!response.ok) {
		throw new Error(`Discord user request failed (${response.status}).`);
	}

	return (await response.json()) as DiscordUser;
}

export async function getGuilds(token: string): Promise<DiscordGuild[]> {
	const response = await fetch(`${API_BASE_URL}/users/@me/guilds`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!response.ok) throw new Error(`Discord guild request failed (${response.status}).`);
	return (await response.json()) as DiscordGuild[];
}
