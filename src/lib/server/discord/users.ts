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

export interface DiscordGuildMember {
	nick: string | null;
	user: DiscordUser & { bot?: boolean };
}

export interface DiscordChannel {
	id: string;
	name: string;
	type: number;
	position: number;
	parent_id: string | null;
	categoryName?: string;
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

function botAuthorization(): string {
	if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is not configured.');
	return `Bot ${process.env.BOT_TOKEN}`;
}

export async function searchGuildMembers(guildId: string, query: string) {
	const params = new URLSearchParams({ query, limit: '20' });
	const response = await fetch(`${API_BASE_URL}/guilds/${guildId}/members/search?${params}`, {
		headers: { Authorization: botAuthorization() }
	});
	if (!response.ok) throw new Error(`Discord member search failed (${response.status}).`);
	return (await response.json()) as DiscordGuildMember[];
}

export async function getGuildMember(guildId: string, userId: string) {
	const response = await fetch(`${API_BASE_URL}/guilds/${guildId}/members/${userId}`, {
		headers: { Authorization: botAuthorization() }
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Discord member request failed (${response.status}).`);
	return (await response.json()) as DiscordGuildMember;
}

export async function getGuildTextChannels(guildId: string): Promise<DiscordChannel[]> {
	const response = await fetch(`${API_BASE_URL}/guilds/${guildId}/channels`, {
		headers: { Authorization: botAuthorization() }
	});
	if (!response.ok) throw new Error(`Discord channel request failed (${response.status}).`);
	const channels = (await response.json()) as DiscordChannel[];
	const categoryNames = new Map(
		channels.filter((channel) => channel.type === 4).map((channel) => [channel.id, channel.name])
	);
	return channels
		.filter((channel) => channel.type === 0 || channel.type === 5)
		.map((channel) => ({
			...channel,
			categoryName: channel.parent_id ? categoryNames.get(channel.parent_id) : undefined
		}))
		.sort((a, b) => a.position - b.position);
}
