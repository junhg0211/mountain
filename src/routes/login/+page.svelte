<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	const { data } = $props();
	const { client_id } = $derived(data);

	const origin = $page.url.origin;
	const redirectUri = encodeURIComponent(origin + '/api/login');

	onMount(async () => {
		window.location.href = `https://discord.com/oauth2/authorize?client_id=${client_id}&response_type=code&redirect_uri=${redirectUri}&scope=identify`;
	});
</script>
