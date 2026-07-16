CREATE DATABASE IF NOT EXISTS mountain;

USE mountain;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    avatar_url VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    balance DECIMAL(15, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY accounts_guild_user_unique (guild_id, user_id),
    INDEX accounts_user_id_fk (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX sessions_expires_at_idx (expires_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_guilds (
    user_id VARCHAR(255) NOT NULL,
    guild_id VARCHAR(255) NOT NULL,
    guild_name VARCHAR(255) NOT NULL,
    icon_hash VARCHAR(255),
    permissions VARCHAR(32) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, guild_id),
    INDEX user_guilds_guild_idx (guild_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id VARCHAR(255) PRIMARY KEY,
    currency_unit VARCHAR(16) NOT NULL DEFAULT 'coin',
    public_balance_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ranking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    notification_channel_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL,
    sender_id VARCHAR(255),
    recipient_id VARCHAR(255),
    amount DECIMAL(15, 2) NOT NULL,
    transaction_type VARCHAR(32) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX transactions_guild_created_idx (guild_id, created_at),
    INDEX transactions_sender_idx (sender_id),
    INDEX transactions_recipient_idx (recipient_id),
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE SET NULL,
    CHECK (amount >= 0.01)
);
