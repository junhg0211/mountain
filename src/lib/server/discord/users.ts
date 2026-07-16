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

async function fetchGuilds(authorization: string): Promise<DiscordGuild[]> {
	const guilds: DiscordGuild[] = [];
	let after: string | undefined;

	do {
		const query = new URLSearchParams({ limit: '200' });
		if (after) query.set('after', after);
		const response = await fetch(`${API_BASE_URL}/users/@me/guilds?${query}`, {
			headers: { Authorization: authorization }
		});
		if (!response.ok) throw new Error(`Discord guild request failed (${response.status}).`);
		const page = (await response.json()) as DiscordGuild[];
		guilds.push(...page);
		after = page.length === 200 ? page.at(-1)?.id : undefined;
	} while (after);

	return guilds;
}

export function getGuilds(token: string): Promise<DiscordGuild[]> {
	return fetchGuilds(`Bearer ${token}`);
}

export async function getBotGuildIds(): Promise<Set<string>> {
	const token = process.env.BOT_TOKEN;
	if (!token) throw new Error('BOT_TOKEN is not configured.');
	const guilds = await fetchGuilds(`Bot ${token}`);
	return new Set(guilds.map((guild) => guild.id));
}
