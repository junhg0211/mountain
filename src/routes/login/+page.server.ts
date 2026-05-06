import type { Load } from '@sveltejs/kit';
import dotenv from 'dotenv';

dotenv.config();

export const load: Load = async () => {
	return { client_id: process.env.CLIENT_ID };
};
