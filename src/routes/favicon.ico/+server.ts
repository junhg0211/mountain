import { redirect, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = () => redirect(308, '/favicon.svg');
