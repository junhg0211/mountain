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
	roles?: string[];
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

export interface DiscordRole {
	id: string;
	name: string;
	color: number;
	position: number;
	managed: boolean;
}

interface DisplayNameCacheEntry {
	name: string | null;
	expiresAt: number;
}

const displayNameCache = new Map<string, DisplayNameCacheEntry>();

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

export async function getGuildRoles(guildId: string): Promise<DiscordRole[]> {
	const response = await fetch(`${API_BASE_URL}/guilds/${guildId}/roles`, {
		headers: { Authorization: botAuthorization() }
	});
	if (!response.ok) throw new Error(`Discord roles request failed (${response.status}).`);
	return ((await response.json()) as DiscordRole[]).sort((a, b) => b.position - a.position);
}

export async function addGuildMemberRole(guildId: string, userId: string, roleId: string) {
	const response = await fetch(`${API_BASE_URL}/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
		method: 'PUT', headers: { Authorization: botAuthorization() }
	});
	if (!response.ok) throw new Error(`Discord role assignment failed (${response.status}).`);
}

export async function removeGuildMemberRole(guildId: string, userId: string, roleId: string) {
	const response = await fetch(`${API_BASE_URL}/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
		method: 'DELETE', headers: { Authorization: botAuthorization() }
	});
	if (!response.ok && response.status !== 404)
		throw new Error(`Discord role removal failed (${response.status}).`);
}

export async function getGuildDisplayNames(guildId: string, userIds: Iterable<string>) {
	const names = new Map<string, string>();
	const uniqueUserIds = [...new Set(userIds)];
	await Promise.all(
		uniqueUserIds.map(async (userId) => {
			const key = `${guildId}:${userId}`;
			const cached = displayNameCache.get(key);
			if (cached && cached.expiresAt > Date.now()) {
				if (cached.name) names.set(userId, cached.name);
				return;
			}
			try {
				const member = await getGuildMember(guildId, userId);
				const name = member ? member.nick || member.user.global_name || member.user.username : null;
				displayNameCache.set(key, { name, expiresAt: Date.now() + 30_000 });
				if (name) names.set(userId, name);
			} catch (error) {
				console.error(`Discord display name lookup failed for ${guildId}/${userId}:`, error);
			}
		})
	);
	return names;
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
