import type { Cookies } from '@sveltejs/kit';

export const SELECTED_GUILD_COOKIE = 'mountain_selected_guild';

type GuildContext = { id: string };

interface SelectGuildContextOptions {
	/** Keep a non-admin selection when choosing an admin-only fallback. */
	preserveInvalidStoredSelection?: boolean;
}

/**
 * Resolves a requested guild before the remembered selection, and only remembers
 * IDs that are present in the server-verified guild list supplied by the caller.
 */
export function selectGuildContext(
	cookies: Cookies,
	requestedGuildId: string | null,
	guilds: readonly GuildContext[],
	options: SelectGuildContextOptions = {}
): string | null {
	const storedGuildId = cookies.get(SELECTED_GUILD_COOKIE);
	const isAvailable = (guildId: string | null | undefined): guildId is string =>
		Boolean(guildId && guilds.some((guild) => guild.id === guildId));

	if (isAvailable(requestedGuildId)) {
		rememberGuildContext(cookies, requestedGuildId);
		return requestedGuildId;
	}
	if (isAvailable(storedGuildId)) return storedGuildId;

	const fallbackGuildId = guilds[0]?.id || null;
	if (fallbackGuildId && (!storedGuildId || !options.preserveInvalidStoredSelection)) {
		rememberGuildContext(cookies, fallbackGuildId);
	}
	if (!fallbackGuildId && !options.preserveInvalidStoredSelection) {
		cookies.delete(SELECTED_GUILD_COOKIE, { path: '/' });
	}
	return fallbackGuildId;
}

export function rememberGuildContext(cookies: Cookies, guildId: string) {
	cookies.set(SELECTED_GUILD_COOKIE, guildId, {
		path: '/',
		maxAge: 60 * 60 * 24 * 30,
		httpOnly: true,
		sameSite: 'lax'
	});
}
