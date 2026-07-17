<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';

	let { clientId }: { clientId: string } = $props();
	let active = $state(false);
	let errorMessage = $state<string | null>(null);
	let authenticating = false;

	onMount(() => {
		const query = new URLSearchParams(window.location.search);
		active = query.has('frame_id') && query.has('instance_id');
		if (active) void authenticateActivity();
	});

	async function authenticateActivity() {
		if (authenticating) return;
		authenticating = true;
		errorMessage = null;
		try {
			if (!clientId) throw new Error('Discord Client ID가 설정되지 않았습니다.');
			const { DiscordSDK } = await import('@discord/embedded-app-sdk');
			const discord = new DiscordSDK(clientId);
			await discord.ready();
			const { code } = await discord.commands.authorize({
				client_id: clientId,
				response_type: 'code',
				prompt: 'none',
				scope: ['identify', 'guilds']
			});
			const response = await fetch('/api/activity/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code })
			});
			const payload = (await response.json()) as { access_token?: string; message?: string };
			if (!response.ok || !payload.access_token)
				throw new Error(payload.message || 'Activity 로그인을 완료하지 못했습니다.');
			const authentication = await discord.commands.authenticate({
				access_token: payload.access_token
			});
			if (!authentication) throw new Error('Discord Activity 인증에 실패했습니다.');
			await invalidateAll();
			active = false;
		} catch (error) {
			console.error('Discord Activity authentication failed:', error);
			errorMessage =
				error instanceof Error ? error.message : 'Discord Activity 로그인에 실패했습니다.';
		} finally {
			authenticating = false;
		}
	}
</script>

{#if active}
	<div class="activity-auth" role="status">
		<div class="mark">M</div>
		{#if errorMessage}
			<h1>로그인하지 못했습니다</h1>
			<p>{errorMessage}</p>
			<button onclick={authenticateActivity}>다시 시도</button>
		{:else}
			<span class="spinner"></span>
			<h1>Mountain에 연결 중</h1>
			<p>Discord Activity 계정으로 안전하게 로그인하고 있습니다.</p>
		{/if}
	</div>
{/if}

<style>
	.activity-auth {
		position: fixed;
		z-index: 1000;
		inset: 0;
		display: grid;
		place-content: center;
		justify-items: center;
		padding: 24px;
		color: #f5f6f8;
		background: #0a0c10;
		text-align: center;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}
	.mark {
		width: 48px;
		height: 48px;
		display: grid;
		place-items: center;
		margin-bottom: 24px;
		border-radius: 14px;
		background: #7657ff;
		font-size: 20px;
		font-weight: 900;
	}
	h1 {
		margin: 14px 0 7px;
		font-size: 24px;
	}
	p {
		max-width: 380px;
		margin: 0;
		color: #8f97a6;
		font-size: 13px;
		line-height: 1.6;
	}
	.spinner {
		width: 27px;
		height: 27px;
		border: 3px solid #30294f;
		border-top-color: #927fff;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	button {
		margin-top: 18px;
		padding: 10px 16px;
		color: #fff;
		background: #7657ff;
		border: 0;
		border-radius: 9px;
		font: inherit;
		font-weight: 750;
		cursor: pointer;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
