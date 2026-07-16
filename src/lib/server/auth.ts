import { getDB } from '$lib/server/db';
import type { Cookies } from '@sveltejs/kit';

const SESSION_COOKIE = 'session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface SessionUser {
	id: string;
	username: string;
	avatarUrl: string | null;
}

export async function createSession(cookies: Cookies, userId: string, secure: boolean) {
	const db = getDB();
	const id = crypto.randomUUID();
	const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

	await db`
		INSERT INTO sessions (id, user_id, expires_at)
		VALUES (${id}, ${userId}, ${expiresAt})
	`;

	cookies.set(SESSION_COOKIE, id, {
		path: '/',
		maxAge: SESSION_TTL_SECONDS,
		httpOnly: true,
		secure,
		sameSite: 'lax'
	});
}

export async function getSessionUserId(cookies: Cookies): Promise<string | null> {
	const id = cookies.get(SESSION_COOKIE);
	if (!id) return null;

	const db = getDB();
	const rows = await db`
		SELECT user_id
		FROM sessions
		WHERE id = ${id} AND expires_at > CURRENT_TIMESTAMP
		LIMIT 1
	`;

	return rows.length === 1 ? String(rows[0].user_id) : null;
}

export async function getSessionUser(cookies: Cookies): Promise<SessionUser | null> {
	const id = cookies.get(SESSION_COOKIE);
	if (!id) return null;

	const db = getDB();
	const rows = await db`
		SELECT users.id, users.username, users.avatar_url
		FROM sessions
		JOIN users ON users.id = sessions.user_id
		WHERE sessions.id = ${id} AND sessions.expires_at > CURRENT_TIMESTAMP
		LIMIT 1
	`;

	if (rows.length !== 1) {
		cookies.delete(SESSION_COOKIE, { path: '/' });
		return null;
	}

	return {
		id: String(rows[0].id),
		username: String(rows[0].username),
		avatarUrl: rows[0].avatar_url ? String(rows[0].avatar_url) : null
	};
}

export async function deleteSession(cookies: Cookies): Promise<void> {
	const id = cookies.get(SESSION_COOKIE);
	if (id) {
		const db = getDB();
		await db`DELETE FROM sessions WHERE id = ${id}`;
	}

	cookies.delete(SESSION_COOKIE, { path: '/' });
}
