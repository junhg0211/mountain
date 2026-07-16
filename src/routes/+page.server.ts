import { deleteSession, getSessionUser } from '$lib/server/auth';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => ({
	user: await getSessionUser(cookies)
});

export const actions: Actions = {
	logout: async ({ cookies }) => {
		await deleteSession(cookies);
		redirect(303, '/');
	}
};
