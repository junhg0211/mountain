<script lang="ts">
	const { data, form } = $props();
	const selectedGuild = $derived(
		data.guilds.find((guild: { id: string }) => guild.id === data.selectedGuildId)
	);
</script>

<svelte:head><title>Mountain Admin</title></svelte:head>
<main>
	<header><a href="/">← 일반 대시보드</a><span>관리자 대시보드</span></header>
	<section class="heading">
		<div>
			<p>ADMINISTRATION</p>
			<h1>경제 설정</h1>
		</div>
		<form method="GET">
			<select name="guild"
				>{#each data.guilds as guild}<option
						value={guild.id}
						selected={guild.id === data.selectedGuildId}>{guild.name}</option
					>{/each}</select
			><button>적용</button>
		</form>
	</section>
	{#if form?.message}<div class:success={form.success} class="notice">{form.message}</div>{/if}
	{#if selectedGuild}<section class="card">
			<span>SERVER SETTINGS</span>
			<h2>{selectedGuild.name}</h2>
			<form method="POST" action={`?/settings&guild=${selectedGuild.id}`}>
				<input type="hidden" name="guildId" value={selectedGuild.id} /><label
					>경제 단위<input
						name="unit"
						value={selectedGuild.currencyUnit}
						maxlength="16"
						required
					/></label
				><button>변경사항 저장</button>
			</form>
		</section>{:else}<section class="empty">관리할 수 있는 서버가 없습니다.</section>{/if}
</main>

<style>
	:global(*) {
		box-sizing: border-box;
	}
	:global(body) {
		margin: 0;
		background: #0a0c10;
		color: #f5f6f8;
		font-family: Inter, system-ui, sans-serif;
	}
	main {
		max-width: 920px;
		margin: auto;
		padding: 0 24px 80px;
	}
	header {
		height: 80px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		border-bottom: 1px solid #232731;
		color: #8f97a6;
	}
	header a {
		color: #b8bfcc;
		text-decoration: none;
	}
	.heading {
		display: flex;
		justify-content: space-between;
		align-items: end;
		padding: 64px 0 28px;
	}
	.heading p,
	.card > span {
		color: #7e8797;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.16em;
	}
	.heading h1 {
		font-size: 44px;
		margin: 8px 0 0;
	}
	.heading form {
		display: flex;
		gap: 8px;
	}
	.card,
	.empty {
		background: #11141a;
		border: 1px solid #242a35;
		border-radius: 18px;
		padding: 28px;
	}
	.card h2 {
		font-size: 28px;
	}
	.card form {
		display: grid;
		gap: 14px;
		max-width: 480px;
		margin-top: 32px;
	}
	label {
		color: #8f97a6;
		font-size: 13px;
	}
	input,
	select,
	button {
		font: inherit;
		border: 1px solid #303744;
		border-radius: 9px;
		padding: 11px 13px;
	}
	input,
	select {
		background: #090b0f;
		color: #fff;
		width: 100%;
	}
	label input {
		display: block;
		margin-top: 7px;
	}
	button {
		background: #7657ff;
		color: white;
		font-weight: 750;
		cursor: pointer;
	}
	.notice {
		padding: 12px 16px;
		background: #492029;
		border-radius: 10px;
		margin-bottom: 18px;
	}
	.notice.success {
		background: #153c32;
	}
	@media (max-width: 650px) {
		.heading {
			align-items: stretch;
			flex-direction: column;
			gap: 22px;
		}
		.heading form {
			width: 100%;
		}
		.heading select {
			flex: 1;
		}
	}
</style>
