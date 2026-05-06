import { getDB } from '../db';

export async function ensureUser(id: string, username: string, avatar_url: string): Promise<void> {
	const db = getDB();

	const existingUser = await db`SELECT * FROM users WHERE id = ${id}`;

	if (existingUser.length === 0) {
		await db`INSERT INTO users (id, username, avatar_url) VALUES (${id}, ${username}, ${avatar_url})`;
	} else {
		await db`UPDATE users SET username = ${username}, avatar_url = ${avatar_url} WHERE id = ${id}`;
	}
}
