<script lang="ts">
	import { onMount } from 'svelte';
	const { data } = $props();
	const { client_id, redirect_uri, state } = $derived(data);

	onMount(async () => {
		const params = new URLSearchParams({
			client_id,
			response_type: 'code',
			redirect_uri,
			scope: 'identify',
			state
		});
		window.location.replace(`https://discord.com/oauth2/authorize?${params}`);
	});
</script>

<p>Discord 로그인 페이지로 이동하고 있습니다…</p>
