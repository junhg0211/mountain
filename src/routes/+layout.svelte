<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import ActivityAuth from '$lib/components/ActivityAuth.svelte';

	let { children, data } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<ActivityAuth clientId={data.discordClientId} />

{@render children()}

<footer class="site-footer">
	<div><span>Mountain</span><small>Discord server economy</small></div>
	<nav>
		<a href="/terms">이용약관</a><a href="/privacy">개인정보처리방침</a><a
			href="mailto:junhg0211@gmail.com">문의</a
		>
	</nav>
</footer>

<style>
	.site-footer {
		max-width: 1180px;
		margin: auto;
		padding: 24px 28px 34px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 20px;
		border-top: 1px solid #20242d;
		color: #707887;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}
	.site-footer div {
		display: grid;
		gap: 3px;
	}
	.site-footer span {
		color: #b8bfcc;
		font-size: 13px;
		font-weight: 800;
	}
	.site-footer small {
		font-size: 10px;
	}
	.site-footer nav {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
	}
	.site-footer a {
		color: #858d9d;
		font-size: 11px;
		text-decoration: none;
	}
	.site-footer a:hover {
		color: #c8beff;
	}
	@media (max-width: 640px) {
		.site-footer {
			padding: 22px 16px 30px;
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
