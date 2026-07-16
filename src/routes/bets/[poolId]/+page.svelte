<script lang="ts">
	import { onMount } from 'svelte';
	let { data, form } = $props();
	let livePool = $state<typeof data.pool>();
	let pool = $derived(livePool ?? data.pool);
	let liveEvents = $state<typeof data.events>();
	let events = $derived(liveEvents ?? data.events);
	let liveStats = $state<typeof data.stats>();
	let stats = $derived(liveStats ?? data.stats);
	let connected = $state(false);
	let pulse = $state(0);
	let selectedTeam = $state<'A' | 'B'>('A');
	let lockedTeam = $derived(
		pool.participants.find((participant) => participant.userId === data.user.id)?.optionKey
	);
	$effect(() => {
		if (lockedTeam) selectedTeam = lockedTeam;
	});
	const amounts = ['0.01', '0.05', '0.1', '0.5', '1', '5', '10', '50', '100', '500'];

	async function refresh() {
		const response = await fetch(`/api/guilds/${data.guildId}/bets?pool=${pool.id}`);
		if (!response.ok) return;
		const payload = await response.json();
		const updated = payload.pool as typeof pool | null;
		if (updated) {
			livePool = updated;
			liveEvents = payload.events;
			liveStats = payload.stats;
			pulse += 1;
		}
	}

	function cents(value: string) {
		const [integer, fraction = ''] = value.split('.');
		return BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
	}
	function money(value: bigint) {
		return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
	}
	function percentage(team: 'A' | 'B') {
		const total = Number(pool.totalAmount);
		return total ? ((Number(pool.optionTotals[team]) / total) * 100).toFixed(1) : '0.0';
	}
	function estimatedPayout(amount: string) {
		const added = cents(amount);
		const existing = pool.participants.find(
			(participant) => participant.userId === data.user.id && participant.optionKey === selectedTeam
		);
		const ownStake = (existing ? cents(existing.amount) : 0n) + added;
		const newTotal = cents(pool.totalAmount) + added;
		const newTeamTotal = cents(pool.optionTotals[selectedTeam]) + added;
		return money((newTotal * ownStake) / newTeamTotal);
	}
	function eventText(event: (typeof events)[number]) {
		if (event.type === 'created') return `${event.username}님이 베팅 판을 만들었습니다.`;
		if (event.type === 'stake')
			return `${event.username}님이 ${event.optionKey}팀에 ${event.amount} ${data.currencyUnit}을 걸었습니다.`;
		if (event.type === 'settled') return `${event.optionKey}팀 승리로 정산됐습니다.`;
		if (event.type === 'refunded') return '모든 베팅이 환불됐습니다.';
		return '베팅 상태가 변경됐습니다.';
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
			<p class="guide">팀을 고른 뒤 금액을 선택하세요. 예상 수령액은 현재 판돈 기준입니다.</p>
			{#if form?.message}<p class="error">{form.message}</p>{/if}
			{#if pool.bettingMode === 'team'}<div class="teams">
					{#each ['A', 'B'] as team}
						<button
							type="button"
							class:active={selectedTeam === team}
							disabled={Boolean(lockedTeam && lockedTeam !== team)}
							onclick={() => (selectedTeam = team as 'A' | 'B')}
						>
							<strong>{team}팀</strong><span>{percentage(team as 'A' | 'B')}%</span><small
								>{pool.optionTotals[team as 'A' | 'B']} {data.currencyUnit}</small
							>
						</button>
					{/each}
				</div>{/if}
			<div class="amounts">
				{#each amounts as amount}
					<form method="POST" action="?/bet">
						<input type="hidden" name="guildId" value={data.guildId} />
						{#if pool.bettingMode === 'team'}<input
								type="hidden"
								name="optionKey"
								value={selectedTeam}
							/>{/if}
						<button name="amount" value={amount} disabled={pool.status !== 'open'}
							><strong>{amount}</strong><span>{data.currencyUnit}</span
							>{#if pool.bettingMode === 'team'}<small>예상 {estimatedPayout(amount)}</small
								>{/if}</button
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
						<b>{participant.optionKey || index + 1}</b><span>{participant.username}</span><strong
							>{participant.amount} {data.currencyUnit}</strong
						>
					</div>
				{:else}<p>아직 베팅한 사람이 없습니다.</p>{/each}
			</div>
			{#if data.canManage && pool.status === 'open'}
				<div class="management">
					<form method="POST" action="?/settle">
						<input type="hidden" name="guildId" value={data.guildId} />
						{#if pool.bettingMode === 'team'}
							<select name="winningOption" required disabled={!pool.participants.length}
								><option value="">승리 팀 선택</option><option value="A">A팀</option><option
									value="B">B팀</option
								></select
							>
							<button disabled={!pool.participants.length}>비율대로 정산</button>
						{:else}
							<select name="winnerId" required disabled={!pool.participants.length}
								><option value="">승자 선택</option>{#each pool.participants as participant}<option
										value={participant.userId}>{participant.username}</option
									>{/each}</select
							>
							<button disabled={!pool.participants.length}>승자에게 지급</button>
						{/if}
					</form>
					<form method="POST" action="?/refund">
						<input type="hidden" name="guildId" value={data.guildId} />
						<button class="refund">전체 환불</button>
					</form>
				</div>
			{/if}
		</section>
	</div>
	<div class="insights">
		<section class="stats-card">
			<p>MY BETTING STATS</p>
			<h2>내 베팅 정보</h2>
			<div>
				<span>참여 판 <b>{stats.poolsJoined}</b></span><span>승리 <b>{stats.poolsWon}</b></span
				><span>누적 베팅 <b>{stats.totalStaked}</b></span><span
					>누적 수령 <b>{stats.totalReturned}</b></span
				><span
					>적중률 <b
						>{stats.poolsJoined
							? ((stats.poolsWon / stats.poolsJoined) * 100).toFixed(1)
							: '0.0'}%</b
					></span
				><span>순손익 <b>{stats.netProfit}</b></span>
			</div>
		</section>
		<section class="events-card">
			<p>LIVE EVENTS</p>
			<h2>실시간 이벤트</h2>
			<ol>
				{#each events as event}<li>
						<i></i><span>{eventText(event)}</span><time
							>{new Date(event.createdAt).toLocaleTimeString('ko-KR', {
								hour: '2-digit',
								minute: '2-digit'
							})}</time
						>
					</li>{:else}<li>아직 이벤트가 없습니다.</li>{/each}
			</ol>
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
	.teams {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		margin-top: 20px;
	}
	.teams button {
		display: grid;
		grid-template-columns: 1fr auto;
		text-align: left;
		gap: 5px;
		padding: 16px;
		border: 1px solid #303747;
		border-radius: 14px;
		background: #151922;
		color: #fff;
		cursor: pointer;
	}
	.teams button.active {
		border-color: #7b65ff;
		background: #211b3c;
		box-shadow: 0 0 20px #6f55ff20;
	}
	.teams strong {
		font-size: 18px;
	}
	.teams span {
		color: #9d8fff;
		font-weight: 900;
	}
	.teams small {
		grid-column: 1/-1;
		color: #7f8795;
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
	.amounts small {
		display: block;
		margin-top: 5px;
		color: #69d7a7;
		font-size: 10px;
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
	.insights {
		display: grid;
		grid-template-columns: 0.8fr 1.2fr;
		gap: 16px;
		margin-top: 16px;
	}
	.stats-card,
	.events-card {
		background: #11141a;
		border: 1px solid #232936;
		border-radius: 20px;
		padding: 24px;
	}
	.stats-card > p,
	.events-card > p {
		margin: 0;
		color: #806cff;
		font-size: 10px;
		font-weight: 900;
		letter-spacing: 0.15em;
	}
	.stats-card h2,
	.events-card h2 {
		margin: 6px 0 18px;
	}
	.stats-card > div {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 9px;
	}
	.stats-card span {
		display: flex;
		justify-content: space-between;
		padding: 12px;
		background: #0c0f14;
		border-radius: 10px;
		color: #858d9c;
		font-size: 11px;
	}
	.stats-card b {
		color: #f1efff;
	}
	.events-card ol {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 280px;
		overflow: auto;
	}
	.events-card li {
		display: grid;
		grid-template-columns: 8px 1fr auto;
		align-items: center;
		gap: 10px;
		padding: 11px 0;
		border-top: 1px solid #242a34;
		font-size: 11px;
	}
	.events-card i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #705af0;
	}
	.events-card time {
		color: #697180;
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
		.insights {
			grid-template-columns: 1fr;
		}
		.amounts {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
