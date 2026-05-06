import { SQL } from 'bun';
import dotenv from 'dotenv';

dotenv.config();

export const db = new SQL(
	`mariadb://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`
);
