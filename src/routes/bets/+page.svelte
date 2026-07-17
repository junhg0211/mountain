<script lang="ts">
	import { formatMoneyDisplay } from '$lib/economy/money-display';
	let { data, form } = $props();
</script>

<svelte:head><title>베팅 대시보드 · Mountain</title></svelte:head>

<main>
	<header>
		<div>
			<p>LIVE ECONOMY</p>
			<h1>베팅 대시보드</h1>
		</div>
		<a href={data.selectedGuildId ? `/?guild=${data.selectedGuildId}` : '/'}>일반 대시보드</a>
	</header>

	{#if data.guilds.length}
		<section class="toolbar">
			<form method="GET">
				<label for="guild">서버</label>
				<select id="guild" name="guild">
					{#each data.guilds as guild}<option
							value={guild.id}
							selected={guild.id === data.selectedGuildId}>{guild.name}</option
						>{/each}
				</select>
				<button>전환</button>
			</form>
			<form method="POST" action="?/create" class="create">
				<input type="hidden" name="guildId" value={data.selectedGuildId || ''} />
				<input name="title" maxlength="80" required placeholder="새 베팅 판 제목" />
				<button>판 만들기</button>
			</form>
		</section>
		{#if form?.message}<p class="notice">{form.message}</p>{/if}
		<section class="grid">
			{#each data.pools as pool}
				<a
					class:closed={pool.status !== 'open'}
					href={`/bets/${pool.id}?guild=${data.selectedGuildId}`}
				>
					<div class="top">
						<span>#{pool.id}</span><b
							>{pool.status === 'open'
								? 'LIVE'
								: pool.status === 'settled'
									? '정산 완료'
									: '환불 완료'}</b
						>
					</div>
					<h2>{pool.title}</h2>
					<p>판 주인 · {pool.ownerName}</p>
					<footer>
						<strong>{formatMoneyDisplay(pool.totalAmount)}</strong><span
							>{pool.participantCount}명 참가 →</span
						>
					</footer>
				</a>
			{:else}<div class="empty">아직 베팅 판이 없습니다.</div>{/each}
		</section>
	{:else}<p class="empty">봇과 함께 있는 서버가 없습니다.</p>{/if}
</main>

<style>
	:global(*) {
		box-sizing: border-box;
	}
	:global(body) {
		margin: 0;
		background: #090b10;
		color: #f5f6fa;
		font-family: Inter, system-ui, sans-serif;
	}
	main {
		max-width: 1180px;
		margin: auto;
		padding: 48px 22px 80px;
	}
	header {
		display: flex;
		align-items: end;
		justify-content: space-between;
		margin-bottom: 32px;
	}
	header p {
		color: #7c65ff;
		font-size: 11px;
		font-weight: 900;
		letter-spacing: 0.16em;
		margin: 0;
	}
	h1 {
		font-size: 42px;
		margin: 6px 0 0;
	}
	header a {
		color: #c8cbd4;
		text-decoration: none;
		border: 1px solid #2a2f3a;
		border-radius: 10px;
		padding: 11px 14px;
	}
	.toolbar {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
		margin-bottom: 18px;
	}
	.toolbar form {
		display: flex;
		gap: 8px;
		padding: 14px;
		background: #11141a;
		border: 1px solid #222732;
		border-radius: 16px;
	}
	.toolbar label {
		align-self: center;
		color: #8c94a3;
		font-size: 12px;
	}
	.toolbar select,
	.toolbar input {
		min-width: 0;
		flex: 1;
		background: #0b0e13;
		color: white;
		border: 1px solid #2a303c;
		border-radius: 10px;
		padding: 12px;
	}
	.toolbar button {
		border: 0;
		border-radius: 10px;
		background: #7258ff;
		color: #fff;
		font-weight: 800;
		padding: 0 17px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px;
	}
	.grid > a {
		display: block;
		color: inherit;
		text-decoration: none;
		background: linear-gradient(145deg, #151925, #101319);
		border: 1px solid #2b3140;
		border-radius: 20px;
		padding: 22px;
		transition: 0.18s;
	}
	.grid > a:hover {
		transform: translateY(-2px);
		border-color: #7660e8;
	}
	.grid > a.closed {
		opacity: 0.62;
	}
	.top,
	footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.top span {
		color: #8d7bff;
		font-weight: 900;
	}
	.top b {
		font-size: 10px;
		color: #63e6ad;
		background: #123225;
		padding: 6px 8px;
		border-radius: 99px;
	}
	h2 {
		margin: 24px 0 6px;
		font-size: 22px;
	}
	.grid p {
		color: #7f8797;
		font-size: 12px;
	}
	.grid footer {
		margin-top: 30px;
	}
	.grid footer strong {
		font-size: 28px;
	}
	.grid footer span {
		color: #999faf;
		font-size: 12px;
	}
	.empty {
		grid-column: 1/-1;
		padding: 80px;
		text-align: center;
		color: #747c8b;
		background: #101319;
		border: 1px dashed #2b303a;
		border-radius: 18px;
	}
	.notice {
		color: #ff8b8b;
	}
	@media (max-width: 720px) {
		main {
			padding: 28px 16px;
		}
		.toolbar,
		.grid {
			grid-template-columns: 1fr;
		}
		.toolbar form {
			flex-wrap: wrap;
		}
		h1 {
			font-size: 32px;
		}
	}
</style>
