<script lang="ts">
	const { data } = $props();
</script>

{#if data.user}
	<p><strong>{data.user.username}</strong>님, 로그인되었습니다.</p>
	<form method="POST" action="?/logout">
		<button type="submit">로그아웃</button>
	</form>
{:else}
	<a href="/login">Discord로 로그인</a>
{/if}
