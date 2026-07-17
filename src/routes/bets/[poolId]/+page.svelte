<script lang="ts">
	import { formatMoneyDisplay } from '$lib/economy/money-display';
	import { onMount } from 'svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	let { data, form } = $props();
	let livePool = $state<typeof data.pool>();
	let pool = $derived(livePool ?? data.pool);
	let liveEvents = $state<typeof data.events>();
	let events = $derived(liveEvents ?? data.events);
	let liveStats = $state<typeof data.stats>();
	let stats = $derived(liveStats ?? data.stats);
	let liveBalance = $state<string>();
	let balance = $derived(liveBalance ?? data.balance);
	let connected = $state(false);
	let socket = $state<WebSocket | null>(null);
	let betPending = $state(false);
	let betMessage = $state('');
	let ignoreNextUpdate = false;
	let pulse = $state(0);
	let selectedTeam = $state<'A' | 'B'>('A');
	let archiveConfirmationOpen = $state(false);
	let archiveForm = $state<HTMLFormElement>();
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
			liveBalance = payload.balance;
			pulse += 1;
		}
	}

	function placeRealtimeBet(amount: string) {
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			betMessage = '실시간 서버에 연결된 뒤 다시 시도해 주세요.';
			return;
		}
		if (pool.bettingMode === 'team' && selectedTeam !== 'A' && selectedTeam !== 'B') {
			betMessage = 'A팀 또는 B팀을 선택해 주세요.';
			return;
		}
		betPending = true;
		betMessage = '';
		ignoreNextUpdate = true;
		socket.send(JSON.stringify({ type: 'place-bet', requestId: crypto.randomUUID(), poolId: pool.id, amount, optionKey: selectedTeam }));
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
			return `${event.username}님이 ${event.optionKey}팀에 ${formatMoneyDisplay(event.amount)} ${data.currencyUnit}을 걸었습니다.`;
		if (event.type === 'settled') return `${event.optionKey}팀 승리로 정산됐습니다.`;
		if (event.type === 'refunded') return '모든 베팅이 환불됐습니다.';
		if (event.type === 'reopened') return '참가자 명단을 유지한 채 새 회차가 시작됐습니다.';
		if (event.type === 'archived') return '베팅 판이 완전히 종료됐습니다.';
		if (event.type === 'funded') return `${event.username}님이 판 자금 ${formatMoneyDisplay(event.amount)} ${data.currencyUnit}을 충전했습니다.`;
		if (event.type === 'user_refund') return `${event.username}님의 베팅액 ${formatMoneyDisplay(event.amount)} ${data.currencyUnit}이 개별 환불됐습니다.`;
		if (event.type === 'double_payout') return `${event.username}님에게 ${formatMoneyDisplay(event.amount)} ${data.currencyUnit}이 2배 당첨금으로 지급됐습니다.`;
		if (event.type === 'weighted_settled') return `가중치 1당 ${formatMoneyDisplay(event.amount)} ${data.currencyUnit}으로 정산됐습니다.`;
		return '베팅 상태가 변경됐습니다.';
	}

	onMount(() => {
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
				if (message.type === 'bet-result') {
					betPending = false;
					if (!message.ok) { betMessage = message.error; ignoreNextUpdate = false; return; }
					liveBalance = message.balance;
					livePool = message.pool;
					liveEvents = message.events;
					liveStats = message.stats;
					betMessage = `베팅이 완료됐습니다. 남은 소지금 ${formatMoneyDisplay(message.balance)} ${data.currencyUnit}`;
					pulse += 1;
					return;
				}
				if (message.type === 'betting-update' && (!message.poolId || message.poolId === pool.id)) {
					if (ignoreNextUpdate) ignoreNextUpdate = false;
					else void refresh();
				}
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
			socket = null;
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
			<small>현재 판돈</small><strong>{formatMoneyDisplay(pool.totalAmount)}</strong><b
				>{data.currencyUnit}</b
			>
			<span>판 보유금 {formatMoneyDisplay(pool.houseBalance)} {data.currencyUnit}</span>
		</div>
	</section>

	<div class="layout">
		<section class="bet-card">
			<header>
				<div>
					<p>QUICK BET</p>
					<h2>베팅 금액 선택</h2>
				</div>
				<div class="bet-state"><span>소지금 <strong>{formatMoneyDisplay(balance)} {data.currencyUnit}</strong></span><b class:closed={pool.status !== 'open'}>{pool.status === 'open' ? '베팅 가능' : '종료됨'}</b></div>
			</header>
			<p class="guide">팀을 고른 뒤 금액을 선택하세요. 예상 수령액은 현재 판돈 기준입니다.</p>
			{#if form?.message}<p class="error">{form.message}</p>{/if}
			{#if betMessage}<p class:success={betMessage.includes('완료')} class="bet-message">{betMessage}</p>{/if}
			{#if pool.bettingMode === 'team'}<div class="teams">
					{#each ['A', 'B'] as team}
						<button
							type="button"
							class:active={selectedTeam === team}
							disabled={Boolean(lockedTeam && lockedTeam !== team)}
							onclick={() => (selectedTeam = team as 'A' | 'B')}
						>
							<strong>{team}팀</strong><span>{percentage(team as 'A' | 'B')}%</span><small
								>{formatMoneyDisplay(pool.optionTotals[team as 'A' | 'B'])}
								{data.currencyUnit}</small
							>
						</button>
					{/each}
				</div>{/if}
			<div class="amounts">
				{#each amounts as amount}
					<button type="button" onclick={() => placeRealtimeBet(amount)} disabled={pool.status !== 'open' || !connected || betPending}
							><strong>{formatMoneyDisplay(amount)}</strong><span>{data.currencyUnit}</span
							>{#if pool.bettingMode === 'team'}<small
									>예상 {formatMoneyDisplay(estimatedPayout(amount))}</small
								>{/if}</button
						>
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
							>{formatMoneyDisplay(participant.amount)} {data.currencyUnit}</strong
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
			{#if data.isOwner && pool.status === 'open'}
				<div class="house-management">
					<div class="house-heading"><div><p>TABLE BANK</p><h3>판 자금과 개별 처리</h3></div><strong>{formatMoneyDisplay(pool.houseBalance)} {data.currencyUnit}</strong></div>
					<form class="fund-form" method="POST" action="?/fund"><input type="hidden" name="guildId" value={data.guildId}><label>판 자금 충전<input name="amount" inputmode="decimal" placeholder="0.01" required></label><button>충전</button></form>
					<p class="house-guide">2배 지급 시 참가자의 베팅액을 포함한 2배를 돌려줍니다. 판 보유금이 모자라면 부족분만 판 주인의 소지금에서 자동 충전됩니다.</p>
					{#each pool.participants.filter((participant) => Number(participant.amount) > 0) as participant}
						<article class="participant-action"><div><strong>{participant.username}</strong><span>{formatMoneyDisplay(participant.amount)} {data.currencyUnit} 베팅</span></div><form method="POST" action="?/refundParticipant"><input type="hidden" name="guildId" value={data.guildId}><input type="hidden" name="userId" value={participant.userId}><button class="single-refund">개별 환불</button></form><form method="POST" action="?/doublePayout"><input type="hidden" name="guildId" value={data.guildId}><input type="hidden" name="userId" value={participant.userId}><button class="double-payout">2배 지급</button></form></article>
					{:else}<p class="no-current-bets">현재 처리할 베팅이 없습니다.</p>{/each}
				</div>
				<div class="weighted-management">
					<div class="weighted-heading"><div><p>WEIGHTED SETTLEMENT</p><h3>평균 기준 가중치 정산</h3></div><span>평균 = 0점</span></div>
					<p>입력한 가중치의 평균을 자동으로 0점으로 잡습니다. 평균보다 낮으면 지급하고 높으면 수령하며, 현재 베팅액은 먼저 전액 환불됩니다.</p>
					<form method="POST" action="?/weightedSettlement">
						<input type="hidden" name="guildId" value={data.guildId}>
						<label class="weighted-unit">가중치 1당 금액 ({data.currencyUnit})<input name="unitAmount" inputmode="decimal" placeholder="100.00" required></label>
						<div class="weight-list">{#each pool.participants as participant}<label><span>{participant.username}</span><input name={`weight_${participant.userId}`} type="number" min="-10000" max="10000" step="1" value="0" required></label>{/each}</div>
						<button disabled={pool.participants.length < 2}>가중치로 회차 정산</button>
					</form>
				</div>
			{/if}
			{#if data.canManage && (pool.status === 'settled' || pool.status === 'refunded')}
				<div class="management reuse-management">
					<form method="POST" action="?/reopen"><input type="hidden" name="guildId" value={data.guildId}><button class="reopen">같은 멤버로 새 회차 시작</button></form>
					{#if data.isOwner}<form bind:this={archiveForm} method="POST" action="?/archive"><input type="hidden" name="guildId" value={data.guildId}><button type="button" class="archive" onclick={() => (archiveConfirmationOpen = true)}>완전히 종료</button></form>{/if}
				</div>
			{/if}
			{#if data.isOwner && pool.status === 'open'}
				<div class="management archive-open"><form bind:this={archiveForm} method="POST" action="?/archive"><input type="hidden" name="guildId" value={data.guildId}><button type="button" class="archive" onclick={() => (archiveConfirmationOpen = true)}>환불 후 완전히 종료</button></form></div>
			{/if}
		</section>
	</div>
	<div class="insights">
		<section class="stats-card">
			<p>MY BETTING STATS</p>
			<h2>내 베팅 정보</h2>
			<div>
				<span>참여 판 <b>{stats.poolsJoined}</b></span><span>승리 <b>{stats.poolsWon}</b></span
				><span>누적 베팅 <b>{formatMoneyDisplay(stats.totalStaked)}</b></span><span
					>누적 수령 <b>{formatMoneyDisplay(stats.totalReturned)}</b></span
				><span
					>적중률 <b
						>{stats.poolsJoined
							? ((stats.poolsWon / stats.poolsJoined) * 100).toFixed(1)
							: '0.0'}%</b
					></span
				><span>순손익 <b>{formatMoneyDisplay(stats.netProfit)}</b></span>
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

<ConfirmDialog open={archiveConfirmationOpen} title="베팅 판을 완전히 종료할까요?" description="완전히 종료된 판은 베팅 목록에서 사라지며 다시 사용할 수 없습니다." confirmLabel="완전히 종료" onconfirm={() => { archiveConfirmationOpen = false; archiveForm?.requestSubmit(); }} oncancel={() => (archiveConfirmationOpen = false)} />

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
	.bet-state b {
		font-size: 10px;
		color: #58dfa5;
		background: #123327;
		padding: 7px 9px;
		border-radius: 99px;
	}
	.bet-state b.closed {
		color: #9198a5;
		background: #262b34;
	}
	.guide {
		color: #737c8c;
		font-size: 12px;
	}
	.bet-state { display: flex; align-items: center; gap: 10px; }
	.bet-state > span { display: grid; gap: 2px; color: #737c8c; font-size: 10px; text-align: right; }
	.bet-state > span strong { color: #f4f5f8; font-size: 13px; font-variant-numeric: tabular-nums; }
	.bet-message { padding: 10px 12px; border-radius: 9px; color: #ff9b9b; background: #32191d; font-size: 12px; }
	.bet-message.success { color: #8de5bf; background: #15382c; }
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
	.reuse-management { grid-template-columns: 1fr auto; }
	.reuse-management form:first-child { min-width: 0; }
	.management .reopen { width: 100%; background: #285d4b; color: #9ff2cf; }
	.management .archive { width: 100%; background: #421d25; color: #ff9aaa; }
	.house-management { margin-top: 18px; padding: 16px; border: 1px solid #2d3441; border-radius: 13px; background: #0c0f14; }
	.house-heading { display: flex; justify-content: space-between; align-items: end; gap: 12px; }
	.house-heading p { margin: 0; color: #806cff; font-size: 9px; font-weight: 900; letter-spacing: .14em; }
	.house-heading h3 { margin: 4px 0 0; font-size: 16px; }
	.house-heading > strong { color: #a99cff; font-variant-numeric: tabular-nums; }
	.fund-form { display: grid; grid-template-columns: 1fr auto; align-items: end; gap: 8px; margin-top: 14px; }
	.fund-form label { display: grid; gap: 5px; color: #858d9b; font-size: 11px; }
	.fund-form input { min-width: 0; height: 40px; padding: 0 10px; color: #fff; background: #151922; border: 1px solid #303746; border-radius: 9px; }
	.fund-form button { height: 40px; }
	.house-guide { color: #737c8c; font-size: 11px; line-height: 1.5; }
	.participant-action { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 7px; padding: 10px 0; border-top: 1px solid #252b35; }
	.participant-action > div { display: grid; gap: 3px; min-width: 0; }
	.participant-action > div strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.participant-action > div span { color: #7c8492; font-size: 10px; }
	.participant-action form { margin: 0; }
	.participant-action button { padding: 8px 10px; border: 0; border-radius: 8px; font-weight: 800; }
	.single-refund { color: #f3c08e; background: #3b2a18; }
	.double-payout { color: #9ff2cf; background: #1b4939; }
	.no-current-bets { margin: 14px 0 0; color: #737c8c; font-size: 11px; }
	.weighted-management { margin-top: 12px; padding: 16px; border: 1px solid #343044; border-radius: 13px; background: #12101a; }
	.weighted-heading { display: flex; justify-content: space-between; align-items: end; gap: 12px; }
	.weighted-heading p { margin: 0; color: #a68cff; font-size: 9px; font-weight: 900; letter-spacing: .14em; }
	.weighted-heading h3 { margin: 4px 0 0; font-size: 16px; }
	.weighted-heading > span { color: #a99cff; font-size: 10px; font-weight: 800; }
	.weighted-management > p { color: #7f788d; font-size: 11px; line-height: 1.5; }
	.weighted-management form { display: grid; gap: 12px; }
	.weighted-management label { color: #8e879a; font-size: 11px; }
	.weighted-unit { display: grid; gap: 5px; }
	.weighted-management input { height: 38px; min-width: 0; padding: 0 10px; color: #fff; background: #0c0a12; border: 1px solid #393344; border-radius: 8px; }
	.weight-list { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
	.weight-list label { display: grid; grid-template-columns: minmax(0, 1fr) 90px; align-items: center; gap: 8px; padding: 7px 9px; background: #191620; border-radius: 8px; }
	.weight-list span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.weighted-management form > button { min-height: 40px; border: 0; border-radius: 9px; color: #fff; background: #745ce8; font-weight: 850; }
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
		.house-heading { align-items: flex-start; flex-direction: column; }
		.participant-action { grid-template-columns: 1fr 1fr; }
		.participant-action > div { grid-column: 1 / -1; }
		.participant-action form button { width: 100%; }
		.weight-list { grid-template-columns: 1fr; }
	}
</style>
