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
	`CREATE TABLE IF NOT EXISTS items (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		guild_id VARCHAR(255) NOT NULL,
		item_key VARCHAR(64) NOT NULL,
		name VARCHAR(80) NOT NULL,
		description VARCHAR(500) NOT NULL DEFAULT '',
		item_type VARCHAR(32) NOT NULL,
		rarity VARCHAR(16) NOT NULL DEFAULT 'common',
		icon_emoji VARCHAR(32) NOT NULL,
		stackable BOOLEAN NOT NULL DEFAULT TRUE,
		max_stack INT,
		tradable BOOLEAN NOT NULL DEFAULT FALSE,
		usable BOOLEAN NOT NULL DEFAULT FALSE,
		consumed_on_use BOOLEAN NOT NULL DEFAULT TRUE,
		purchase_price DECIMAL(15, 2),
		sell_price DECIMAL(15, 2),
		effect_type VARCHAR(32),
		effect_config JSON,
		active BOOLEAN NOT NULL DEFAULT TRUE,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		UNIQUE KEY items_guild_key_unique (guild_id, item_key),
		UNIQUE KEY items_guild_id_unique (guild_id, id),
		INDEX items_guild_active_idx (guild_id, active),
		CHECK (max_stack IS NULL OR max_stack >= 1),
		CHECK (purchase_price IS NULL OR purchase_price >= 0.01),
		CHECK (sell_price IS NULL OR sell_price >= 0.01)
	)`,
	`CREATE TABLE IF NOT EXISTS inventories (
		guild_id VARCHAR(255) NOT NULL,
		user_id VARCHAR(255) NOT NULL,
		item_id BIGINT NOT NULL,
		quantity INT NOT NULL,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		PRIMARY KEY (guild_id, user_id, item_id),
		INDEX inventories_user_idx (guild_id, user_id),
		INDEX inventories_item_fk (guild_id, item_id),
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (guild_id, item_id) REFERENCES items(guild_id, id) ON DELETE RESTRICT,
		CHECK (quantity >= 1)
	)`,
	`CREATE TABLE IF NOT EXISTS item_movements (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		guild_id VARCHAR(255) NOT NULL,
		user_id VARCHAR(255) NOT NULL,
		item_id BIGINT NOT NULL,
		quantity_delta INT NOT NULL,
		movement_type VARCHAR(32) NOT NULL,
		reference_type VARCHAR(32),
		reference_id VARCHAR(64),
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		INDEX item_movements_user_idx (guild_id, user_id, created_at),
		INDEX item_movements_item_fk (guild_id, item_id),
		INDEX item_movements_reference_idx (guild_id, reference_type, reference_id),
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (guild_id, item_id) REFERENCES items(guild_id, id) ON DELETE RESTRICT,
		CHECK (quantity_delta <> 0)
	)`,
	`CREATE TABLE IF NOT EXISTS item_uses (
		id CHAR(36) PRIMARY KEY,
		guild_id VARCHAR(255) NOT NULL,
		user_id VARCHAR(255) NOT NULL,
		item_id BIGINT NOT NULL,
		quantity INT NOT NULL DEFAULT 1,
		status VARCHAR(16) NOT NULL DEFAULT 'pending',
		effect_type VARCHAR(32) NOT NULL,
		effect_config JSON NOT NULL,
		error_message VARCHAR(255),
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		completed_at TIMESTAMP NULL,
		INDEX item_uses_user_idx (guild_id, user_id, created_at),
		INDEX item_uses_item_fk (guild_id, item_id),
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (guild_id, item_id) REFERENCES items(guild_id, id) ON DELETE RESTRICT,
		CHECK (quantity >= 1)
	)`,
	`CREATE TABLE IF NOT EXISTS guild_settings (
		guild_id VARCHAR(255) PRIMARY KEY,
		currency_unit VARCHAR(16) NOT NULL DEFAULT 'coin',
		public_balance_enabled BOOLEAN NOT NULL DEFAULT TRUE,
		ranking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
		attendance_reward DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
		voice_activity_reward DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
		voice_activity_daily_cap DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
		monthly_burn_enabled BOOLEAN NOT NULL DEFAULT TRUE,
		monthly_burn_basis_points INT NOT NULL DEFAULT 1000,
		monthly_burn_day TINYINT NOT NULL DEFAULT 1,
		monthly_burn_hour TINYINT NOT NULL DEFAULT 12,
		monthly_burn_minute TINYINT NOT NULL DEFAULT 0,
		monthly_burn_next_at BIGINT,
		notification_channel_id VARCHAR(255),
		world_category_id VARCHAR(255),
		world_access_role_id VARCHAR(255),
		world_lobby_channel_id VARCHAR(255),
		world_background_tile VARCHAR(32) NOT NULL DEFAULT 'grass',
		world_spawn_x DOUBLE NOT NULL DEFAULT 20,
		world_spawn_y DOUBLE NOT NULL DEFAULT 15,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS world_rooms (
		id CHAR(36) PRIMARY KEY,
		guild_id VARCHAR(255) NOT NULL,
		name VARCHAR(80) NOT NULL,
		x INT NOT NULL,
		y INT NOT NULL,
		width INT NOT NULL,
		height INT NOT NULL,
		discord_voice_channel_id VARCHAR(255),
		status VARCHAR(16) NOT NULL DEFAULT 'creating',
		created_by VARCHAR(255) NOT NULL,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		UNIQUE KEY world_rooms_guild_channel_unique (guild_id, discord_voice_channel_id),
		INDEX world_rooms_guild_status_idx (guild_id, status),
		FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
		CHECK (width >= 2 AND height >= 2)
	)`,
	`CREATE TABLE IF NOT EXISTS world_walls (
		id CHAR(36) PRIMARY KEY,
		guild_id VARCHAR(255) NOT NULL,
		x INT NOT NULL,
		y INT NOT NULL,
		width INT NOT NULL,
		height INT NOT NULL,
		orientation VARCHAR(10) NOT NULL DEFAULT 'horizontal',
		created_by VARCHAR(255) NOT NULL,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		INDEX world_walls_guild_idx (guild_id),
		FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
		CHECK (width >= 1 AND height >= 1)
	)`,
	`CREATE TABLE IF NOT EXISTS monthly_burn_runs (
		guild_id VARCHAR(255) NOT NULL,
		burn_period CHAR(7) NOT NULL,
		total_amount DECIMAL(30, 2) NOT NULL,
		accounts_affected INT NOT NULL,
		executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (guild_id, burn_period),
		INDEX monthly_burn_runs_executed_idx (executed_at)
	)`,
	`CREATE TABLE IF NOT EXISTS role_subscription_plans (
		id BIGINT AUTO_INCREMENT PRIMARY KEY, guild_id VARCHAR(255) NOT NULL,
		role_id VARCHAR(255) NOT NULL, name VARCHAR(80) NOT NULL,
		monthly_price DECIMAL(15, 2) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		UNIQUE KEY role_subscription_plans_guild_role (guild_id, role_id),
		INDEX role_subscription_plans_guild_active (guild_id, active), CHECK (monthly_price >= 0.01)
	)`,
	`CREATE TABLE IF NOT EXISTS role_subscriptions (
		id BIGINT AUTO_INCREMENT PRIMARY KEY, plan_id BIGINT NOT NULL, guild_id VARCHAR(255) NOT NULL,
		user_id VARCHAR(255) NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'active', next_charge_at BIGINT,
		last_error VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		UNIQUE KEY role_subscriptions_plan_user (plan_id, user_id),
		INDEX role_subscriptions_due (status, next_charge_at),
		FOREIGN KEY (plan_id) REFERENCES role_subscription_plans(id) ON DELETE CASCADE,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	)`,
	`CREATE TABLE IF NOT EXISTS scheduled_transfers (
		id BIGINT AUTO_INCREMENT PRIMARY KEY, guild_id VARCHAR(255) NOT NULL,
		sender_id VARCHAR(255) NOT NULL, recipient_id VARCHAR(255) NOT NULL, amount DECIMAL(15, 2) NOT NULL,
		schedule_type VARCHAR(16) NOT NULL, interval_days INT, weekday TINYINT, month_day TINYINT,
		run_hour TINYINT NOT NULL, run_minute TINYINT NOT NULL, next_run_at BIGINT NOT NULL,
		status VARCHAR(16) NOT NULL DEFAULT 'active', last_error VARCHAR(255),
		total_transferred DECIMAL(30, 2) NOT NULL DEFAULT 0.00,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		INDEX scheduled_transfers_sender (guild_id, sender_id, status),
		INDEX scheduled_transfers_due (status, next_run_at),
		FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE, CHECK (amount >= 0.01)
	)`,
	`CREATE TABLE IF NOT EXISTS automatic_payment_runs (
		id BIGINT AUTO_INCREMENT PRIMARY KEY, payment_type VARCHAR(24) NOT NULL,
		reference_id BIGINT NOT NULL, run_key VARCHAR(32) NOT NULL, guild_id VARCHAR(255) NOT NULL,
		amount DECIMAL(15, 2) NOT NULL, status VARCHAR(16) NOT NULL, error_message VARCHAR(255),
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		UNIQUE KEY automatic_payment_runs_once (payment_type, reference_id, run_key),
		INDEX automatic_payment_runs_guild_created (guild_id, created_at)
	)`,
	`CREATE TABLE IF NOT EXISTS voice_activity_rewards (
		guild_id VARCHAR(255) NOT NULL,
		user_id VARCHAR(255) NOT NULL,
		reward_bucket BIGINT NOT NULL,
		reward_date DATE NOT NULL,
		channel_id VARCHAR(255) NOT NULL,
		participant_count INT NOT NULL,
		amount DECIMAL(15, 2) NOT NULL,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (guild_id, user_id, reward_bucket),
		INDEX voice_activity_rewards_guild_date_idx (guild_id, reward_date),
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
		CHECK (amount >= 0.01)
	)`,
	`CREATE TABLE IF NOT EXISTS member_activity_daily (
		guild_id VARCHAR(255) NOT NULL,
		user_id VARCHAR(255) NOT NULL,
		activity_date DATE NOT NULL,
		message_count INT UNSIGNED NOT NULL DEFAULT 0,
		voice_seconds INT UNSIGNED NOT NULL DEFAULT 0,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		PRIMARY KEY (guild_id, user_id, activity_date),
		INDEX member_activity_daily_guild_date_idx (guild_id, activity_date),
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	)`,
	`CREATE TABLE IF NOT EXISTS attendance_claims (
		guild_id VARCHAR(255) NOT NULL,
		user_id VARCHAR(255) NOT NULL,
		attendance_date DATE NOT NULL,
		reward_amount DECIMAL(15, 2) NOT NULL,
		claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (guild_id, user_id, attendance_date),
		INDEX attendance_claims_guild_date_idx (guild_id, attendance_date),
		INDEX attendance_claims_user_idx (user_id),
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
		CHECK (reward_amount >= 0.01)
	)`,
	`CREATE TABLE IF NOT EXISTS attendance_streaks (
		guild_id VARCHAR(255) NOT NULL,
		user_id VARCHAR(255) NOT NULL,
		current_streak INT NOT NULL DEFAULT 0,
		longest_streak INT NOT NULL DEFAULT 0,
		last_attendance_date DATE NOT NULL,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		PRIMARY KEY (guild_id, user_id),
		INDEX attendance_streaks_guild_longest_idx (guild_id, longest_streak, current_streak),
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	)`,
	`CREATE TABLE IF NOT EXISTS attendance_reminder_runs (
		guild_id VARCHAR(255) NOT NULL,
		reminder_date DATE NOT NULL,
		chunk_index INT NOT NULL,
		reservation_id CHAR(36) NOT NULL,
		reserved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		sent_at TIMESTAMP NULL DEFAULT NULL,
		PRIMARY KEY (guild_id, reminder_date, chunk_index),
		INDEX attendance_reminder_runs_sent_idx (sent_at)
	)`,
	`CREATE TABLE IF NOT EXISTS betting_pools (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		guild_id VARCHAR(255) NOT NULL,
		owner_id VARCHAR(255) NOT NULL,
		title VARCHAR(80) NOT NULL,
		betting_mode VARCHAR(16) NOT NULL DEFAULT 'legacy',
		status VARCHAR(16) NOT NULL DEFAULT 'open',
		winner_id VARCHAR(255),
		winning_option VARCHAR(1),
		house_balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		closed_at TIMESTAMP NULL,
		INDEX betting_pools_guild_status_idx (guild_id, status, created_at),
		INDEX betting_pools_owner_idx (owner_id)
	)`,
	`CREATE TABLE IF NOT EXISTS betting_entries (
		pool_id BIGINT NOT NULL,
		user_id VARCHAR(255) NOT NULL,
		option_key VARCHAR(1),
		amount DECIMAL(15, 2) NOT NULL,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		PRIMARY KEY (pool_id, user_id),
		INDEX betting_entries_user_idx (user_id),
		FOREIGN KEY (pool_id) REFERENCES betting_pools(id) ON DELETE CASCADE,
		CHECK (amount >= 0.01)
	)`,
	`CREATE TABLE IF NOT EXISTS betting_pool_members (
		pool_id BIGINT NOT NULL,
		user_id VARCHAR(255) NOT NULL,
		joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (pool_id, user_id),
		INDEX betting_pool_members_user_idx (user_id),
		FOREIGN KEY (pool_id) REFERENCES betting_pools(id) ON DELETE CASCADE,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	)`,
	`CREATE TABLE IF NOT EXISTS betting_events (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		pool_id BIGINT NOT NULL,
		event_type VARCHAR(24) NOT NULL,
		user_id VARCHAR(255),
		option_key VARCHAR(1),
		amount DECIMAL(15, 2),
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		INDEX betting_events_pool_created_idx (pool_id, created_at),
		FOREIGN KEY (pool_id) REFERENCES betting_pools(id) ON DELETE CASCADE,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
	)`,
	`CREATE TABLE IF NOT EXISTS betting_weighted_results (
		event_id BIGINT NOT NULL,
		user_id VARCHAR(255) NOT NULL,
		weight INT NOT NULL,
		amount DECIMAL(15, 2) NOT NULL,
		PRIMARY KEY (event_id, user_id),
		FOREIGN KEY (event_id) REFERENCES betting_events(id) ON DELETE CASCADE,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	)`,
	`CREATE TABLE IF NOT EXISTS transactions (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		guild_id VARCHAR(255) NOT NULL,
		sender_id VARCHAR(255),
		recipient_id VARCHAR(255),
		amount DECIMAL(15, 2) NOT NULL,
		transaction_type VARCHAR(32) NOT NULL,
		betting_pool_id BIGINT,
		item_use_id CHAR(36),
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		INDEX transactions_guild_created_idx (guild_id, created_at),
		INDEX transactions_sender_idx (sender_id),
		INDEX transactions_recipient_idx (recipient_id),
		INDEX transactions_betting_pool_idx (betting_pool_id),
		INDEX transactions_item_use_idx (item_use_id),
		FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL,
		FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE SET NULL,
		FOREIGN KEY (betting_pool_id) REFERENCES betting_pools(id) ON DELETE SET NULL,
		FOREIGN KEY (item_use_id) REFERENCES item_uses(id) ON DELETE SET NULL,
		CHECK (amount >= 0.01)
	)`
] as const;

const REPAIRS = [
	`ALTER TABLE items ADD COLUMN IF NOT EXISTS icon_emoji VARCHAR(32) NOT NULL DEFAULT '🎁'`,
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
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS attendance_reward DECIMAL(15, 2) NOT NULL DEFAULT 0.00`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS voice_activity_reward DECIMAL(15, 2) NOT NULL DEFAULT 0.00`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS voice_activity_daily_cap DECIMAL(15, 2) NOT NULL DEFAULT 0.00`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS monthly_burn_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS monthly_burn_basis_points INT NOT NULL DEFAULT 1000`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS monthly_burn_day TINYINT NOT NULL DEFAULT 1`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS monthly_burn_hour TINYINT NOT NULL DEFAULT 12`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS monthly_burn_minute TINYINT NOT NULL DEFAULT 0`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS monthly_burn_next_at BIGINT`,
	`ALTER TABLE monthly_burn_runs MODIFY COLUMN total_amount DECIMAL(30, 2) NOT NULL`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS notification_channel_id VARCHAR(255)`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS world_category_id VARCHAR(255)`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS world_access_role_id VARCHAR(255)`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS world_lobby_channel_id VARCHAR(255)`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS world_background_tile VARCHAR(32) NOT NULL DEFAULT 'grass'`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS world_spawn_x DOUBLE NOT NULL DEFAULT 20`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS world_spawn_y DOUBLE NOT NULL DEFAULT 15`,
	`ALTER TABLE world_walls ADD COLUMN IF NOT EXISTS orientation VARCHAR(10) NOT NULL DEFAULT 'horizontal'`,
	`UPDATE world_walls SET orientation='vertical' WHERE height > width`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
	`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,
	`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_type VARCHAR(32) NOT NULL DEFAULT 'transfer'`,
	`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS betting_pool_id BIGINT`,
	`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS item_use_id CHAR(36)`,
	`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
	`ALTER TABLE transactions ADD INDEX IF NOT EXISTS transactions_guild_created_idx (guild_id, created_at)`,
	`ALTER TABLE transactions ADD INDEX IF NOT EXISTS transactions_sender_idx (sender_id)`,
	`ALTER TABLE transactions ADD INDEX IF NOT EXISTS transactions_recipient_idx (recipient_id)`,
	`ALTER TABLE transactions ADD INDEX IF NOT EXISTS transactions_betting_pool_idx (betting_pool_id)`,
	`ALTER TABLE transactions ADD INDEX IF NOT EXISTS transactions_item_use_idx (item_use_id)`,
	`ALTER TABLE betting_pools ADD COLUMN IF NOT EXISTS betting_mode VARCHAR(16) NOT NULL DEFAULT 'legacy'`,
	`ALTER TABLE betting_pools ADD COLUMN IF NOT EXISTS winning_option VARCHAR(1)`,
	`ALTER TABLE betting_pools ADD COLUMN IF NOT EXISTS house_balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00`,
	`ALTER TABLE betting_entries ADD COLUMN IF NOT EXISTS option_key VARCHAR(1)`
] as const;

async function repairItemUseForeignKey(connection: SQL, databaseName: string): Promise<void> {
	const rows = await connection`
		SELECT 1
		FROM information_schema.KEY_COLUMN_USAGE
		WHERE TABLE_SCHEMA=${databaseName}
			AND TABLE_NAME='transactions'
			AND COLUMN_NAME='item_use_id'
			AND REFERENCED_TABLE_SCHEMA=${databaseName}
			AND REFERENCED_TABLE_NAME='item_uses'
			AND REFERENCED_COLUMN_NAME='id'
		LIMIT 1
	`;
	if (rows.length > 0) return;
	await connection.unsafe(
		'ALTER TABLE transactions ADD FOREIGN KEY (item_use_id) REFERENCES item_uses(id) ON DELETE SET NULL'
	);
}

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
		await repairItemUseForeignKey(connection, databaseName);
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
