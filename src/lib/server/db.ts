import { SQL } from 'bun';
import dotenv from 'dotenv';

dotenv.config();

let dbPromise: Promise<SQL> | null = null;

const TABLES = [
	`CREATE TABLE IF NOT EXISTS users (
		id VARCHAR(255) PRIMARY KEY,
		username VARCHAR(255) NOT NULL,
		avatar_url VARCHAR(255),
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS accounts (
		id INT AUTO_INCREMENT PRIMARY KEY,
		guild_id VARCHAR(255) NOT NULL,
		user_id VARCHAR(255) NOT NULL,
		balance DECIMAL(15, 2) DEFAULT 0.00,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		UNIQUE KEY accounts_guild_user_unique (guild_id, user_id),
		INDEX accounts_user_id_fk (user_id),
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	)`,
	`CREATE TABLE IF NOT EXISTS sessions (
		id VARCHAR(36) PRIMARY KEY,
		user_id VARCHAR(255) NOT NULL,
		expires_at TIMESTAMP NOT NULL,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		INDEX sessions_expires_at_idx (expires_at),
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	)`,
	`CREATE TABLE IF NOT EXISTS user_guilds (
		user_id VARCHAR(255) NOT NULL,
		guild_id VARCHAR(255) NOT NULL,
		guild_name VARCHAR(255) NOT NULL,
		icon_hash VARCHAR(255),
		permissions VARCHAR(32) NOT NULL,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		PRIMARY KEY (user_id, guild_id),
		INDEX user_guilds_guild_idx (guild_id),
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	)`,
	`CREATE TABLE IF NOT EXISTS guild_settings (
		guild_id VARCHAR(255) PRIMARY KEY,
		currency_unit VARCHAR(16) NOT NULL DEFAULT 'coin',
		public_balance_enabled BOOLEAN NOT NULL DEFAULT TRUE,
		ranking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
		notification_channel_id VARCHAR(255),
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS betting_pools (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		guild_id VARCHAR(255) NOT NULL,
		owner_id VARCHAR(255) NOT NULL,
		title VARCHAR(80) NOT NULL,
		status VARCHAR(16) NOT NULL DEFAULT 'open',
		winner_id VARCHAR(255),
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		closed_at TIMESTAMP NULL,
		INDEX betting_pools_guild_status_idx (guild_id, status, created_at),
		INDEX betting_pools_owner_idx (owner_id)
	)`,
	`CREATE TABLE IF NOT EXISTS betting_entries (
		pool_id BIGINT NOT NULL,
		user_id VARCHAR(255) NOT NULL,
		amount DECIMAL(15, 2) NOT NULL,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		PRIMARY KEY (pool_id, user_id),
		INDEX betting_entries_user_idx (user_id),
		FOREIGN KEY (pool_id) REFERENCES betting_pools(id) ON DELETE CASCADE,
		CHECK (amount >= 0.01)
	)`,
	`CREATE TABLE IF NOT EXISTS transactions (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		guild_id VARCHAR(255) NOT NULL,
		sender_id VARCHAR(255),
		recipient_id VARCHAR(255),
		amount DECIMAL(15, 2) NOT NULL,
		transaction_type VARCHAR(32) NOT NULL,
		betting_pool_id BIGINT,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		INDEX transactions_guild_created_idx (guild_id, created_at),
		INDEX transactions_sender_idx (sender_id),
		INDEX transactions_recipient_idx (recipient_id),
		INDEX transactions_betting_pool_idx (betting_pool_id),
		FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL,
		FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE SET NULL,
		FOREIGN KEY (betting_pool_id) REFERENCES betting_pools(id) ON DELETE SET NULL,
		CHECK (amount >= 0.01)
	)`
] as const;

const REPAIRS = [
	`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(255)`,
	`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
	`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS balance DECIMAL(15, 2) DEFAULT 0.00`,
	`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
	`ALTER TABLE accounts ADD UNIQUE INDEX IF NOT EXISTS accounts_guild_user_unique (guild_id, user_id)`,
	`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
	`ALTER TABLE sessions ADD INDEX IF NOT EXISTS sessions_expires_at_idx (expires_at)`,
	`ALTER TABLE user_guilds ADD COLUMN IF NOT EXISTS icon_hash VARCHAR(255)`,
	`ALTER TABLE user_guilds ADD COLUMN IF NOT EXISTS permissions VARCHAR(32) NOT NULL DEFAULT '0'`,
	`ALTER TABLE user_guilds ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,
	`ALTER TABLE user_guilds ADD INDEX IF NOT EXISTS user_guilds_guild_idx (guild_id)`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS currency_unit VARCHAR(16) NOT NULL DEFAULT 'coin'`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS public_balance_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS ranking_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS notification_channel_id VARCHAR(255)`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,
	`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_type VARCHAR(32) NOT NULL DEFAULT 'transfer'`,
	`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS betting_pool_id BIGINT`,
	`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
	`ALTER TABLE transactions ADD INDEX IF NOT EXISTS transactions_guild_created_idx (guild_id, created_at)`,
	`ALTER TABLE transactions ADD INDEX IF NOT EXISTS transactions_sender_idx (sender_id)`,
	`ALTER TABLE transactions ADD INDEX IF NOT EXISTS transactions_recipient_idx (recipient_id)`,
	`ALTER TABLE transactions ADD INDEX IF NOT EXISTS transactions_betting_pool_idx (betting_pool_id)`
] as const;

function databaseUrl(databaseName?: string): string {
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
	if (databaseName) url.pathname = `/${databaseName}`;
	return url.toString();
}

async function initializeDatabase(): Promise<SQL> {
	const databaseName = process.env.DB_NAME!;
	if (!/^[A-Za-z0-9_$]+$/.test(databaseName)) {
		throw new Error('DB_NAME may only contain letters, numbers, underscores, and dollar signs.');
	}

	let connection = new SQL(databaseUrl(databaseName));
	try {
		await connection.unsafe('SELECT 1');
	} catch {
		await connection.close();
		const admin = new SQL(databaseUrl());
		try {
			await admin.unsafe(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\``);
		} finally {
			await admin.close();
		}
		connection = new SQL(databaseUrl(databaseName));
	}

	try {
		for (const statement of TABLES) await connection.unsafe(statement);
		for (const statement of REPAIRS) await connection.unsafe(statement);
		return connection;
	} catch (error) {
		await connection.close();
		throw error;
	}
}

export function getDB(): Promise<SQL> {
	if (!dbPromise) {
		dbPromise = initializeDatabase().catch((error) => {
			dbPromise = null;
			throw error;
		});
	}
	return dbPromise;
}

export async function closeDB(): Promise<void> {
	const current = dbPromise;
	dbPromise = null;
	if (!current) return;
	const db = await current;
	await db.close();
}
