import { SQL } from 'bun';
import dotenv from 'dotenv';

dotenv.config();

let db: SQL | null = null;

export function getDB() {
	if (!db) {
		const required = ['DB_USER', 'DB_PASS', 'DB_HOST', 'DB_PORT', 'DB_NAME'] as const;
		const missing = required.filter((key) => !process.env[key]);
		if (missing.length > 0) {
			throw new Error(`Missing database environment variables: ${missing.join(', ')}`);
		}

		const url = new URL('mysql://localhost');
		url.username = process.env.DB_USER!;
		url.password = process.env.DB_PASS!;
		url.hostname = process.env.DB_HOST!;
		url.port = process.env.DB_PORT!;
		url.pathname = `/${process.env.DB_NAME!}`;

		db = new SQL(url.toString());
	}

	return db;
}
