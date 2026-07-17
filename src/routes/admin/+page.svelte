<script lang="ts">
	import { formatMoneyDisplay } from '$lib/economy/money-display';
	const { data, form } = $props();
	const selectedGuild = $derived(
		data.guilds.find((guild: { id: string }) => guild.id === data.selectedGuildId)
	);
	type Member = { id: string; username: string; avatarUrl: string | null };
	let query = $state('');
	let results = $state<Member[]>([]);
	let target = $state<Member | null>(null);
	let searching = $state(false);
	let searchSequence = 0;
	let timer: ReturnType<typeof setTimeout>;
	function schedule() {
		target = null;
		clearTimeout(timer);
		timer = setTimeout(search, 250);
	}
	async function search() {
		target = null;
		const memberQuery = query.trim();
		const sequence = ++searchSequence;
		if (!selectedGuild || !memberQuery) {
			results = [];
			searching = false;
			return;
		}
		searching = true;
		const response = await fetch(
			`/api/guilds/${selectedGuild.id}/members?q=${encodeURIComponent(memberQuery)}&includeSelf=true`
		);
		const body = response.ok ? await response.json() : { members: [] };
		if (sequence === searchSequence) {
			results = body.members;
			searching = false;
		}
	}
	function choose(member: Member) {
		target = member;
		query = member.username;
		results = [];
	}
	type Transaction = (typeof data.transactions)[number];
	const transactionLabels: Record<Transaction['type'], string> = {
		transfer: '송금',
		mint: '발행',
		burn: '소각',
		bet_stake: '베팅 참여',
		bet_payout: '베팅 지급',
		bet_refund: '베팅 환불',
		attendance: '출석 보상',
		voice_activity: '음성 활동 보상'
	};
	function transactionRoute(transaction: Transaction) {
		const sender = transaction.sender?.name || '시스템';
		const recipient = transaction.recipient?.name || '시스템';
		return `${sender} → ${recipient}`;
	}
	function formatTime(value: string) {
		return new Intl.DateTimeFormat('ko-KR', {
			timeZone: 'Asia/Seoul',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		}).format(new Date(value));
	}
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
			<div class="supply">
				<span>총 유통량</span><strong
					>{formatMoneyDisplay(data.totalSupply)} {selectedGuild.currencyUnit}</strong
				>
			</div>
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
			<form
				method="POST"
				action={`?/attendance&guild=${selectedGuild.id}`}
				class="attendance-settings"
			>
				<input type="hidden" name="guildId" value={selectedGuild.id} />
				<h3>출석 보상</h3>
				<p>한국 시간 기준으로 서버 구성원에게 하루 한 번 지급합니다. 0은 비활성화입니다.</p>
				<label
					>일일 지급액<input
						name="amount"
						inputmode="decimal"
						value={selectedGuild.attendanceReward}
						placeholder="0.00"
						required
					/></label
				>
				<button>출석 보상 저장</button>
			</form>
			<form
				method="POST"
				action={`?/voiceActivity&guild=${selectedGuild.id}`}
				class="voice-settings"
			>
				<input type="hidden" name="guildId" value={selectedGuild.id} />
				<h3>음성 활동 보상</h3>
				<p>5분마다 지급하며 같은 채널의 사람이 적을수록 더 많이 받습니다. 0, 0은 비활성화입니다.</p>
				<div class="settings-grid">
					<label
						>5분당 기본 보상<input
							name="reward"
							inputmode="decimal"
							value={selectedGuild.voiceActivityReward}
							required
						/></label
					>
					<label
						>사용자별 일일 한도<input
							name="dailyCap"
							inputmode="decimal"
							value={selectedGuild.voiceActivityDailyCap}
							required
						/></label
					>
				</div>
				<small>2명 2배 · 3명 1.5배 · 4명 1.25배 · 5명 이상 기본 보상</small>
				<button>음성 활동 보상 저장</button>
			</form>
			<form method="POST" action={`?/visibility&guild=${selectedGuild.id}`} class="visibility">
				<input type="hidden" name="guildId" value={selectedGuild.id} />
				<h3>공개 범위</h3>
				<label class="toggle"
					><input
						type="checkbox"
						name="publicBalanceEnabled"
						checked={selectedGuild.publicBalanceEnabled}
					/><span
						><b>다른 사용자 소지금 조회</b><small
							>사용자가 서로의 소지금을 확인할 수 있습니다.</small
						></span
					></label
				>
				<label class="toggle"
					><input
						type="checkbox"
						name="rankingEnabled"
						checked={selectedGuild.rankingEnabled}
					/><span><b>소지금 순위</b><small>서버의 상위 잔액 순위를 공개합니다.</small></span></label
				>
				<button>공개 설정 저장</button>
			</form>
			<form
				method="POST"
				action={`?/notifications&guild=${selectedGuild.id}`}
				class="notifications"
			>
				<input type="hidden" name="guildId" value={selectedGuild.id} />
				<h3>거래 알림 채널</h3>
				<p>송금, 발행·소각, 베팅, 출석 보상이 발생하면 선택한 Discord 채널에 기록합니다.</p>
				<label class="channel-select"
					>알림 채널<select name="channelId"
						><option value="">알림 사용 안 함</option>{#each data.channels as channel}<option
								value={channel.id}
								selected={channel.id === selectedGuild.notificationChannelId}
								>{channel.categoryName ? `${channel.categoryName} / ` : ''}# {channel.name}</option
							>{/each}</select
					></label
				>
				<button>알림 채널 저장</button>
			</form>
			<form method="POST" action={`?/mint&guild=${selectedGuild.id}`} class="issuance">
				<input type="hidden" name="guildId" value={selectedGuild.id} /><input
					type="hidden"
					name="targetId"
					value={target?.id || ''}
				/>
				<h3>화폐 발행 및 소각</h3>
				<label class="search"
					>대상 사용자<input
						bind:value={query}
						oninput={schedule}
						autocomplete="off"
						placeholder="닉네임 또는 사용자 이름 검색"
					/>{#if searching}<span class="search-state">검색 중…</span>{/if}{#if results.length}<div
							class="results"
						>
							{#each results as member}<button type="button" onclick={() => choose(member)}
									>{#if member.avatarUrl}<img src={member.avatarUrl} alt="" />{:else}<i
											>{member.username.slice(0, 1)}</i
										>{/if}<span>{member.username}</span></button
								>{/each}
						</div>{/if}</label
				>
				{#if target}<div class="selected-user">
						{#if target.avatarUrl}<img src={target.avatarUrl} alt="" />{:else}<i
								>{target.username.slice(0, 1)}</i
							>{/if}
						<div>
							<small>작업 대상</small><strong>{target.username}</strong><code>{target.id}</code>
						</div>
						<span>선택됨 ✓</span>
					</div>{/if}
				<label>금액<input name="amount" inputmode="decimal" placeholder="0.01" required /></label>
				<div class="buttons">
					<button type="submit" disabled={!target}>Mint · 발행</button><button
						class="danger"
						type="submit"
						disabled={!target}
						formaction={`?/burn&guild=${selectedGuild.id}`}>Burn · 소각</button
					>
				</div>
			</form>
			<section class="transaction-log">
				<div class="log-heading">
					<div>
						<span>SERVER LEDGER</span>
						<h3>최근 트랜잭션</h3>
					</div>
					<small>최근 {data.transactions.length}건 · 한국 시간</small>
				</div>
				{#if data.transactions.length}
					<div class="log-table">
						{#each data.transactions as transaction}
							<article>
								<div class="log-kind">
									<b class={`kind ${transaction.type}`}>{transactionLabels[transaction.type]}</b
									><time>{formatTime(transaction.createdAt)}</time>
								</div>
								<div class="log-route">
									<strong>{transactionRoute(transaction)}</strong>{#if transaction.bettingPool}<a
											href={`/bets/${transaction.bettingPool.id}`}
											>#{transaction.bettingPool.id} {transaction.bettingPool.title}</a
										>{/if}
								</div>
								<strong class="log-amount"
									>{formatMoneyDisplay(transaction.amount)} {selectedGuild.currencyUnit}</strong
								>
							</article>
						{/each}
					</div>
				{:else}<div class="log-empty">아직 기록된 트랜잭션이 없습니다.</div>{/if}
			</section>
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
		max-width: 1180px;
		margin: auto;
		padding: 0 28px 80px;
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
	.supply {
		margin: 24px 0;
		padding: 20px;
		background: #17132b;
		border-radius: 12px;
	}
	.supply span {
		display: block;
		color: #8f97a6;
		font-size: 12px;
	}
	.supply strong {
		display: block;
		font-size: 34px;
		margin-top: 6px;
	}
	.issuance {
		border-top: 1px solid #292e39;
		padding-top: 26px;
	}
	.search {
		position: relative;
	}
	.results {
		position: absolute;
		z-index: 5;
		top: 68px;
		left: 0;
		right: 0;
		background: #181c24;
		border: 1px solid #303744;
		border-radius: 9px;
		padding: 5px;
		box-shadow: 0 14px 35px #0008;
	}
	.results button {
		width: 100%;
		text-align: left;
		background: transparent;
		display: flex;
		align-items: center;
		gap: 9px;
	}
	.results img,
	.results i {
		width: 28px;
		height: 28px;
		border-radius: 50%;
	}
	.results i {
		display: grid;
		place-items: center;
		background: #7657ff;
		font-style: normal;
	}
	.search-state {
		position: absolute;
		right: 12px;
		top: 36px;
		color: #7f8796;
	}
	.selected-user {
		display: flex;
		align-items: center;
		gap: 11px;
		padding: 12px;
		background: #10291f;
		border: 1px solid #24523f;
		border-radius: 10px;
	}
	.selected-user img,
	.selected-user i {
		width: 38px;
		height: 38px;
		border-radius: 50%;
	}
	.selected-user i {
		display: grid;
		place-items: center;
		background: #7657ff;
		font-style: normal;
	}
	.selected-user div {
		display: grid;
		gap: 1px;
		flex: 1;
	}
	.selected-user small,
	.selected-user code {
		color: #7f9d90;
		font-size: 10px;
	}
	.selected-user strong {
		font-size: 14px;
	}
	.selected-user > span {
		color: #76d9b0;
		font-size: 11px;
		font-weight: 750;
	}
	.buttons {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.buttons .danger {
		background: #842f43;
	}
	.card form {
		display: grid;
		gap: 14px;
		max-width: 480px;
		margin-top: 32px;
	}
	.transaction-log {
		border-top: 1px solid #292e39;
		margin-top: 32px;
		padding-top: 28px;
	}
	.log-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 14px;
	}
	.log-heading span {
		color: #7e8797;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.16em;
	}
	.log-heading h3 {
		margin: 6px 0 0;
		font-size: 22px;
	}
	.log-heading small {
		color: #747d8d;
	}
	.log-table {
		border: 1px solid #292e39;
		border-radius: 12px;
		overflow: hidden;
	}
	.log-table article {
		display: grid;
		grid-template-columns: 150px minmax(0, 1fr) auto;
		gap: 18px;
		align-items: center;
		padding: 15px 17px;
		background: #0c0f14;
	}
	.log-table article + article {
		border-top: 1px solid #20252e;
	}
	.log-kind,
	.log-route {
		display: grid;
		gap: 5px;
		min-width: 0;
	}
	.log-kind time,
	.log-route a {
		color: #747d8d;
		font-size: 11px;
	}
	.log-route strong,
	.log-route a {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.log-route a {
		color: #9585ff;
		text-decoration: none;
	}
	.kind {
		width: max-content;
		color: #c6cbd4;
		font-size: 11px;
		padding: 4px 7px;
		border-radius: 5px;
		background: #242a35;
	}
	.kind.mint,
	.kind.bet_payout,
	.kind.bet_refund,
	.kind.attendance,
	.kind.voice_activity {
		color: #78dcb2;
		background: #153c32;
	}
	.kind.burn,
	.kind.bet_stake {
		color: #f099aa;
		background: #492029;
	}
	.log-amount {
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.log-empty {
		padding: 28px;
		text-align: center;
		color: #747d8d;
		border: 1px dashed #303744;
		border-radius: 12px;
	}
	.visibility {
		border-top: 1px solid #292e39;
		padding-top: 26px;
	}
	.notifications {
		border-top: 1px solid #292e39;
		padding-top: 26px;
	}
	.attendance-settings,
	.voice-settings {
		border-top: 1px solid #292e39;
		padding-top: 26px;
	}
	.attendance-settings h3,
	.attendance-settings p,
	.voice-settings h3,
	.voice-settings p {
		margin: 0;
	}
	.attendance-settings p,
	.voice-settings p,
	.voice-settings > small {
		color: #747d8d;
		font-size: 13px;
	}
	.settings-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	@media (max-width: 720px) {
		.settings-grid {
			grid-template-columns: 1fr;
		}
	}
	.notifications h3 {
		margin: 0;
	}
	.notifications > p {
		color: #747d8d;
		font-size: 13px;
		margin: 0;
	}
	.channel-select select {
		display: block;
		margin-top: 8px;
	}
	.visibility h3 {
		margin: 0 0 6px;
	}
	.toggle {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		background: #0b0d12;
		padding: 14px;
		border-radius: 10px;
	}
	.toggle input {
		width: 18px;
		margin: 2px 0;
	}
	.toggle span {
		display: grid;
		gap: 4px;
	}
	.toggle b {
		color: #f2f3f5;
	}
	.toggle small {
		color: #747d8d;
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
	input:not([type='checkbox']):not([type='hidden']),
	select,
	button {
		box-sizing: border-box;
		height: 42px;
	}
	button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
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
		main {
			padding: 0 16px 50px;
		}
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
		.log-table article {
			grid-template-columns: 1fr auto;
			gap: 10px;
		}
		.log-route {
			grid-column: 1 / -1;
			grid-row: 2;
		}
		.log-amount {
			grid-column: 2;
			grid-row: 1;
		}
		.log-heading {
			align-items: start;
			flex-direction: column;
		}
	}
</style>
