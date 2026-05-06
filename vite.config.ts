import { plugin as discordBot } from './src/lib/bot';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit(), discordBot]
});
