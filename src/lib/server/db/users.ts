import { getDB } from '../db';

export async function ensureUser(id: string, username: string, avatar_url: string): Promise<void> {
	const db = getDB();

	await db`
		INSERT INTO users (id, username, avatar_url)
		VALUES (${id}, ${username}, ${avatar_url})
		ON DUPLICATE KEY UPDATE
			username = VALUES(username),
			avatar_url = VALUES(avatar_url)
	`;
}
