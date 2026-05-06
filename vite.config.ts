import { plugin as discordBot } from './src/lib/server/bot';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit(), discordBot]
});
