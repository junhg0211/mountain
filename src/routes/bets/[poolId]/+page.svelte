<script lang="ts">
	import { onMount } from 'svelte';
	let { data, form } = $props();
	let livePool = $state<typeof data.pool>();
	let pool = $derived(livePool ?? data.pool);
	let connected = $state(false);
	let pulse = $state(0);
	const amounts = ['0.01', '0.05', '0.1', '0.5', '1', '5', '10', '50', '100', '500'];

	async function refresh() {
		const response = await fetch(`/api/guilds/${data.guildId}/bets?pool=${pool.id}`);
		if (!response.ok) return;
		const updated = (await response.json()).pool as typeof pool | null;
		if (updated) {
			livePool = updated;
			pulse += 1;
		}
	}

	onMount(() => {
		let socket: WebSocket | null = null;
		let stopped = false;
		let retry: ReturnType<typeof setTimeout>;
		async function connect() {
			const response = await fetch(`/api/guilds/${data.guildId}/realtime-ticket`, {
				method: 'POST'
			});
			if (!response.ok || stopped) return;
			const { ticket } = await response.json();
			const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
			socket = new WebSocket(
				`${protocol}//${location.host}/ws/betting?ticket=${encodeURIComponent(ticket)}`
			);
			socket.onopen = () => (connected = true);
			socket.onmessage = (event) => {
				const message = JSON.parse(event.data);
				if (message.type === 'betting-update' && (!message.poolId || message.poolId === pool.id))
					void refresh();
			};
			socket.onclose = () => {
				connected = false;
				if (!stopped) retry = setTimeout(connect, 1500);
			};
		}
		void connect();
		return () => {
			stopped = true;
			clearTimeout(retry);
			socket?.close();
		};
	});
</script>

<svelte:head><title>{pool.title} · 베팅</title></svelte:head>
<main>
	<nav>
		<a href={`/bets?guild=${data.guildId}`}>← 베팅 대시보드</a><span class:live={connected}
			><i></i>{connected ? '실시간 연결됨' : '연결 중'}</span
		>
	</nav>
	<section class="hero" class:pulse={pulse % 2 === 1}>
		<div>
			<p>BETTING POOL #{pool.id}</p>
			<h1>{pool.title}</h1>
			<span>판 주인 · {pool.ownerName}</span>
		</div>
		<div class="total">
			<small>현재 판돈</small><strong>{pool.totalAmount}</strong><b>{data.currencyUnit}</b>
		</div>
	</section>

	<div class="layout">
		<section class="bet-card">
			<header>
				<div>
					<p>QUICK BET</p>
					<h2>베팅 금액 선택</h2>
				</div>
				<b class:closed={pool.status !== 'open'}
					>{pool.status === 'open' ? '베팅 가능' : '종료됨'}</b
				>
			</header>
			<p class="guide">원하는 단위를 누르면 즉시 해당 금액을 베팅합니다.</p>
			{#if form?.message}<p class="error">{form.message}</p>{/if}
			<div class="amounts">
				{#each amounts as amount}
					<form method="POST" action="?/bet">
						<input type="hidden" name="guildId" value={data.guildId} />
						<button name="amount" value={amount} disabled={pool.status !== 'open'}
							><strong>{amount}</strong><span>{data.currencyUnit}</span></button
						>
					</form>
				{/each}
			</div>
		</section>

		<section class="participants">
			<header>
				<div>
					<p>LIVE PARTICIPANTS</p>
					<h2>참가 현황</h2>
				</div>
				<span>{pool.participantCount}명</span>
			</header>
			<div class="list">
				{#each pool.participants as participant, index}
					<div>
						<b>{index + 1}</b><span>{participant.username}</span><strong
							>{participant.amount} {data.currencyUnit}</strong
						>
					</div>
				{:else}<p>아직 베팅한 사람이 없습니다.</p>{/each}
			</div>
			{#if data.canManage && pool.status === 'open'}
				<div class="management">
					<form method="POST" action="?/settle">
						<input type="hidden" name="guildId" value={data.guildId} />
						<select name="winnerId" required disabled={!pool.participants.length}>
							<option value="">승자 선택</option>
							{#each pool.participants as participant}<option value={participant.userId}
									>{participant.username}</option
								>{/each}
						</select>
						<button disabled={!pool.participants.length}>승자에게 지급</button>
					</form>
					<form method="POST" action="?/refund">
						<input type="hidden" name="guildId" value={data.guildId} />
						<button class="refund">전체 환불</button>
					</form>
				</div>
			{/if}
		</section>
	</div>
</main>

<style>
	:global(*) {
		box-sizing: border-box;
	}
	:global(body) {
		margin: 0;
		background: #080a0f;
		color: #f4f5f8;
		font-family: Inter, system-ui, sans-serif;
	}
	main {
		max-width: 1180px;
		margin: auto;
		padding: 36px 22px 80px;
	}
	nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 24px;
	}
	nav a {
		color: #aeb4c1;
		text-decoration: none;
	}
	nav span {
		color: #7f8795;
		font-size: 11px;
	}
	nav i {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #667080;
		margin-right: 7px;
	}
	.live {
		color: #6fdfad;
	}
	nav .live i {
		background: #52dfa3;
		box-shadow: 0 0 14px #52dfa3;
	}
	.hero {
		display: flex;
		justify-content: space-between;
		align-items: end;
		gap: 24px;
		padding: 34px;
		border: 1px solid #292f3b;
		border-radius: 24px;
		background:
			radial-gradient(circle at 80% 10%, #29205c 0, transparent 35%),
			linear-gradient(140deg, #151925, #0f1218);
		transition: 0.25s;
	}
	.hero.pulse {
		border-color: #705cf2;
		box-shadow: 0 0 32px #6f55ff18;
	}
	.hero p,
	.bet-card header p,
	.participants header p {
		margin: 0;
		color: #806cff;
		font-size: 10px;
		font-weight: 900;
		letter-spacing: 0.15em;
	}
	.hero h1 {
		font-size: clamp(30px, 5vw, 54px);
		margin: 8px 0;
	}
	.hero span {
		color: #848c9b;
	}
	.total {
		text-align: right;
	}
	.total small {
		display: block;
		color: #7f8795;
	}
	.total strong {
		font-size: clamp(42px, 7vw, 72px);
		letter-spacing: -0.06em;
	}
	.total b {
		color: #907fff;
		margin-left: 8px;
	}
	.layout {
		display: grid;
		grid-template-columns: 1.15fr 0.85fr;
		gap: 16px;
		margin-top: 16px;
	}
	.bet-card,
	.participants {
		background: #11141a;
		border: 1px solid #232936;
		border-radius: 20px;
		padding: 24px;
	}
	.bet-card header,
	.participants header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.bet-card h2,
	.participants h2 {
		margin: 5px 0;
	}
	.bet-card header > b {
		font-size: 10px;
		color: #58dfa5;
		background: #123327;
		padding: 7px 9px;
		border-radius: 99px;
	}
	.bet-card header > b.closed {
		color: #9198a5;
		background: #262b34;
	}
	.guide {
		color: #737c8c;
		font-size: 12px;
	}
	.amounts {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 9px;
		margin-top: 24px;
	}
	.amounts form {
		margin: 0;
	}
	.amounts button {
		width: 100%;
		min-height: 68px;
		border: 1px solid #303747;
		border-radius: 13px;
		background: #171b24;
		color: #fff;
		cursor: pointer;
		transition: 0.15s;
	}
	.amounts button:hover:not(:disabled) {
		border-color: #7964fa;
		background: #211b3c;
		transform: translateY(-1px);
	}
	.amounts button:active:not(:disabled) {
		transform: scale(0.97);
	}
	.amounts button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.amounts strong {
		font-size: 20px;
	}
	.amounts span {
		display: block;
		color: #8e83cd;
		font-size: 10px;
		margin-top: 3px;
	}
	.participants header > span {
		color: #9d90f4;
		font-size: 12px;
	}
	.list {
		margin-top: 22px;
	}
	.list > div {
		display: grid;
		grid-template-columns: 24px 1fr auto;
		gap: 10px;
		padding: 13px 0;
		border-top: 1px solid #252a34;
		font-size: 12px;
	}
	.list b {
		color: #7562df;
	}
	.list strong {
		color: #73ddb1;
	}
	.list p {
		color: #747c8b;
		text-align: center;
		padding: 50px 0;
	}
	.management {
		margin-top: 20px;
		padding-top: 16px;
		border-top: 1px solid #292e38;
		display: grid;
		gap: 8px;
	}
	.management form {
		display: flex;
		gap: 7px;
	}
	.management select {
		min-width: 0;
		flex: 1;
		background: #0b0e13;
		color: #fff;
		border: 1px solid #303746;
		border-radius: 9px;
		padding: 10px;
	}
	.management button {
		border: 0;
		border-radius: 9px;
		background: #6952eb;
		color: #fff;
		font-weight: 800;
		padding: 10px 12px;
	}
	.management .refund {
		width: 100%;
		background: #352027;
		color: #ff9aa9;
	}
	.error {
		color: #ff8d8d;
		background: #32191d;
		padding: 10px;
		border-radius: 9px;
		font-size: 12px;
	}
	@media (max-width: 760px) {
		main {
			padding: 24px 16px;
		}
		.hero {
			align-items: flex-start;
			flex-direction: column;
		}
		.total {
			text-align: left;
		}
		.layout {
			grid-template-columns: 1fr;
		}
		.amounts {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
