<script lang="ts">
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import { formatMoneyDisplay } from '$lib/economy/money-display';

	const { data, form } = $props();
	const selectedGuild = $derived(
		data.guilds.find((guild: { id: string }) => guild.id === data.selectedGuildId)
	);
	type Member = { id: string; username: string; avatarUrl: string | null };
	let memberQuery = $state('');
	let memberResults = $state<Member[]>([]);
	let selectedRecipient = $state<Member | null>(null);
	let transferAmount = $state('');
	let transferConfirmationOpen = $state(false);
	let transferForm = $state<HTMLFormElement>();
	let transferConfirmed = false;
	let searching = $state(false);
	let searchSequence = 0;
	let searchTimer: ReturnType<typeof setTimeout>;
	function scheduleMemberSearch() {
		selectedRecipient = null;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(searchMembers, 250);
	}
	async function searchMembers() {
		selectedRecipient = null;
		const query = memberQuery.trim();
		const sequence = ++searchSequence;
		if (!selectedGuild || !query) {
			memberResults = [];
			return;
		}
		searching = true;
		const response = await fetch(
			`/api/guilds/${selectedGuild.id}/members?q=${encodeURIComponent(query)}`
		);
		const body = response.ok ? await response.json() : { members: [] };
		if (sequence === searchSequence) {
			memberResults = body.members;
			searching = false;
		}
	}
	function chooseMember(member: Member) {
		selectedRecipient = member;
		memberQuery = member.username;
		memberResults = [];
	}
	function confirmTransfer(event: SubmitEvent) {
		if (transferConfirmed) {
			transferConfirmed = false;
			return;
		}
		event.preventDefault();
		if (selectedRecipient && selectedGuild) transferConfirmationOpen = true;
	}
	function submitConfirmedTransfer() {
		transferConfirmationOpen = false;
		transferConfirmed = true;
		transferForm?.requestSubmit();
	}
	function transactionTitle(transaction: {
		type:
			| 'transfer'
			| 'mint'
			| 'burn'
			| 'bet_stake'
			| 'bet_payout'
			| 'bet_refund'
			| 'bet_fund'
			| 'bet_house_cover'
			| 'bet_house_refund'
			| 'bet_weighted'
			| 'attendance'
			| 'voice_activity'
			| 'monthly_burn'
			| 'role_subscription'
			| 'scheduled_transfer';
		direction: 'credit' | 'debit';
		counterparty: string | null;
		bettingPool: { id: string; title: string } | null;
	}) {
		if (transaction.type === 'mint') return '관리자 발행';
		if (transaction.type === 'burn') return '관리자 소각';
		if (transaction.type === 'attendance') return '일일 출석 보상';
		if (transaction.type === 'voice_activity') return '음성 활동 보상';
		if (transaction.type === 'monthly_burn') return '월간 보유금 소각';
		if (transaction.type === 'role_subscription') return '역할 구독 결제';
		if (transaction.type === 'bet_stake')
			return `#${transaction.bettingPool?.id} ${transaction.bettingPool?.title} 베팅`;
		if (transaction.type === 'bet_payout')
			return `#${transaction.bettingPool?.id} ${transaction.bettingPool?.title} 당첨금`;
		if (transaction.type === 'bet_refund')
			return `#${transaction.bettingPool?.id} ${transaction.bettingPool?.title} 환불`;
		if (transaction.type === 'bet_fund') return `#${transaction.bettingPool?.id} 판 자금 충전`;
		if (transaction.type === 'bet_house_cover') return `#${transaction.bettingPool?.id} 판 자금 자동 보충`;
		if (transaction.type === 'bet_house_refund') return `#${transaction.bettingPool?.id} 남은 판 자금 반환`;
		if (transaction.type === 'bet_weighted') return transaction.direction === 'credit' ? `#${transaction.bettingPool?.id} 가중치 정산 수령` : `#${transaction.bettingPool?.id} 가중치 정산 지급`;
		return transaction.direction === 'credit'
			? `${transaction.counterparty}님에게서 받음`
			: `${transaction.counterparty}님에게 송금`;
	}
	function formatTransactionTime(value: string) {
		return new Intl.DateTimeFormat('ko-KR', {
			timeZone: 'Asia/Seoul',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(value));
	}
</script>

<svelte:head><title>Mountain Economy</title></svelte:head>

<main>
	<header>
		<a class="brand" href="/"><span class="mark">M</span><span>Mountain</span></a>
		{#if data.user}
			<div class="user">
				<span>{data.user.username}</span>
				{#if selectedGuild}<a class="admin-button" href={`/payments?guild=${selectedGuild.id}`}>자동 결제</a>{/if}
				{#if selectedGuild?.canManage}<a
						class="admin-button"
						href={`/admin?guild=${selectedGuild.id}`}>서버 관리</a
					>{/if}
				<form method="POST" action="?/logout"><button class="ghost">로그아웃</button></form>
			</div>
		{/if}
	</header>

	{#if !data.user}
		<section class="hero">
			<p class="eyebrow">DISCORD ECONOMY, ONE PLACE</p>
			<h1>서버의 경제를<br />더 선명하게.</h1>
			<p class="lead">Discord에서 쓰던 경제 기능을 웹에서도 같은 잔액과 설정으로 관리하세요.</p>
			<a class="primary large" href="/login">Discord로 시작하기</a>
		</section>
	{:else if data.guilds.length === 0}
		<section class="empty">
			<span class="empty-icon">M</span>
			<h1>함께 참여 중인 서버가 없습니다.</h1>
			<p>Mountain 봇을 Discord 서버에 추가한 뒤 다시 로그인해 주세요.</p>
		</section>
	{:else}
		<section class="context-bar">
			<div>
				<p class="eyebrow">CURRENT CONTEXT</p>
				<h1>서버 대시보드</h1>
			</div>
			<form method="GET" class="context-picker">
				<label for="guild">서버 컨텍스트</label>
				<div>
					<select id="guild" name="guild"
						>{#each data.guilds as guild}<option
								value={guild.id}
								selected={guild.id === data.selectedGuildId}>{guild.name}</option
							>{/each}</select
					><button type="submit">적용</button>
				</div>
			</form>
		</section>

		{#if data.notice}<p class="notice success">{data.notice}</p>{/if}
		{#if form?.message}<p class="notice">{form.message}</p>{/if}

		{#if selectedGuild}
			<section class="server-heading">
				<div class="server-identity">
					{#if selectedGuild.iconUrl}<img src={selectedGuild.iconUrl} alt="" />{:else}<span
							class="server-icon">{selectedGuild.name.slice(0, 1)}</span
						>{/if}
					<div>
						<p class="eyebrow">SELECTED SERVER</p>
						<h2>{selectedGuild.name}</h2>
					</div>
				</div>
				<span class="status" class:connected={data.botConnected}
					><i></i> {data.botConnected ? '봇 연결됨' : '봇 연결 끊김'}</span
				>
			</section>

			<div class="dashboard">
				<section class="card balance-card">
					<div>
						<p class="card-label">내 소지금</p>
						<strong>{formatMoneyDisplay(selectedGuild.balance)}</strong><span
							>{selectedGuild.currencyUnit}</span
						>
					</div>
					<p>이 잔액은 현재 선택한 서버에서만 사용됩니다.</p>
				</section>

				{#if selectedGuild.voiceActivity}
					<section class="card reward-card">
						<div class="reward-heading">
							<div>
								<p class="card-label">AVAILABLE REWARD</p>
								<h3>음성 활동 보상</h3>
								<p>청각 차단을 해제하고 음성 채널에 5분간 머무르면 자동으로 지급됩니다.</p>
							</div>
							<div class="reward-cap">
								<span>오늘 남은 보상</span><strong
									>{formatMoneyDisplay(data.voiceRewardRemaining)}</strong
								><small>{selectedGuild.currencyUnit}</small>
							</div>
						</div>
						<div class="voice-rates">
							<div class="featured">
								<span>혼자 시작</span><strong
									>{formatMoneyDisplay(selectedGuild.voiceActivity.soloReward)}</strong
								><small>{selectedGuild.currencyUnit} / 5분</small>
							</div>
							<div>
								<span>2명</span><strong
									>{formatMoneyDisplay(selectedGuild.voiceActivity.twoPersonReward)}</strong
								><small>{selectedGuild.currencyUnit}</small>
							</div>
							<div>
								<span>3명</span><strong
									>{formatMoneyDisplay(selectedGuild.voiceActivity.threePersonReward)}</strong
								><small>{selectedGuild.currencyUnit}</small>
							</div>
							<div>
								<span>4명</span><strong
									>{formatMoneyDisplay(selectedGuild.voiceActivity.fourPersonReward)}</strong
								><small>{selectedGuild.currencyUnit}</small>
							</div>
							<div>
								<span>5명 이상</span><strong
									>{formatMoneyDisplay(selectedGuild.voiceActivity.groupReward)}</strong
								><small>{selectedGuild.currencyUnit}</small>
							</div>
						</div>
					</section>
				{/if}

				{#if data.attendance && data.attendance.reward !== '0.00'}
					<div class="attendance-grid">
						<section class="card attendance-card">
							<div>
								<p class="card-label">DAILY ATTENDANCE</p>
								<h3>오늘의 출석</h3>
								{#if data.attendance.claimed}
									<p>오늘의 보상을 이미 받았습니다. 내일 다시 만나요!</p>
								{:else}
									<p>하루 한 번 출석하고 서버 보상을 받아보세요.</p>
								{/if}
							</div>
							<div class="attendance-reward">
								<div class="streak-summary">
									<span>현재 연속 <b>{data.attendance.currentStreak}일</b></span>
									<span>최장 연속 <b>{data.attendance.longestStreak}일</b></span>
								</div>
								<strong>{formatMoneyDisplay(data.attendance.reward)}</strong><span
									>{selectedGuild.currencyUnit}</span
								>
								<form method="POST" action={`?/attendance&guild=${selectedGuild.id}`}>
									<input type="hidden" name="guildId" value={selectedGuild.id} />
									<button disabled={data.attendance.claimed}
										>{data.attendance.claimed ? '출석 완료 ✓' : '출석하기'}</button
									>
								</form>
							</div>
						</section>

						<section class="card attendance-ranking-card">
							<div class="history-heading">
								<div>
									<p class="card-label">ATTENDANCE STREAK</p>
									<h3>연속 출석 리더보드</h3>
								</div>
								<span>최장 기록 기준</span>
							</div>
							{#if data.attendanceLeaderboard.length}
								<ol class="attendance-ranking">
									{#each data.attendanceLeaderboard as entry}
										<li>
											<b>{entry.rank}</b><span>{entry.username}</span>
											<small>현재 {entry.currentStreak}일</small><strong
												>최장 {entry.longestStreak}일</strong
											>
										</li>
									{/each}
								</ol>
							{:else}
								<p class="history-empty">아직 연속 출석 기록이 없습니다.</p>
							{/if}
						</section>
					</div>
				{/if}

				<a class="card betting-link" href={`/bets?guild=${selectedGuild.id}`}>
					<div>
						<p class="card-label">LIVE BETTING</p>
						<h3>베팅 대시보드</h3>
						<span>실시간 베팅 판을 확인하고 참가하세요.</span>
					</div>
					<strong>입장하기 →</strong>
				</a>

				<section class="card action-card" class:full-width={!selectedGuild.rankingEnabled}>
					<div class="card-title">
						<span>01</span>
						<div>
							<h3>송금</h3>
							<p>같은 서버의 사용자에게 보냅니다.</p>
						</div>
					</div>
					<form
						bind:this={transferForm}
						method="POST"
						action={`?/transfer&guild=${selectedGuild.id}`}
						onsubmit={confirmTransfer}
					>
						<input type="hidden" name="guildId" value={selectedGuild.id} />
						<label class="member-search"
							>받는 사람<input
								bind:value={memberQuery}
								oninput={scheduleMemberSearch}
								autocomplete="off"
								placeholder="닉네임 또는 사용자 이름 검색"
							/><input
								type="hidden"
								name="recipientId"
								value={selectedRecipient?.id || ''}
							/>{#if searching}<span class="search-state">검색 중…</span
								>{/if}{#if memberResults.length}<div class="results">
									{#each memberResults as member}<button
											type="button"
											onclick={() => chooseMember(member)}
											>{#if member.avatarUrl}<img src={member.avatarUrl} alt="" />{:else}<i
													>{member.username.slice(0, 1)}</i
												>{/if}<span>{member.username}</span></button
										>{/each}
								</div>{/if}</label
						>
						{#if selectedRecipient}<div class="selected-user">
								{#if selectedRecipient.avatarUrl}<img
										src={selectedRecipient.avatarUrl}
										alt=""
									/>{:else}<i>{selectedRecipient.username.slice(0, 1)}</i>{/if}
								<div>
									<small>선택된 사용자</small><strong>{selectedRecipient.username}</strong><code
										>{selectedRecipient.id}</code
									>
								</div>
								<span>선택됨 ✓</span>
							</div>{/if}
						<label
							>금액
							<div class="amount">
								<input
									name="amount"
									inputmode="decimal"
									placeholder="0.01"
									required
									bind:value={transferAmount}
								/><span>{selectedGuild.currencyUnit}</span>
							</div></label
						>
						<div class="button-row">
							<button class="primary" type="submit" disabled={!selectedRecipient}>송금하기</button>
						</div>
					</form>
				</section>

				{#if selectedGuild.rankingEnabled}
					<section class="card action-card ranking-card">
						<div class="card-title">
							<span>02</span>
							<div>
								<h3>소지금 순위</h3>
								<p>현재 서버의 상위 계좌입니다.</p>
							</div>
						</div>
						<ol class="ranking">
							{#each data.ranking as entry}<li>
									<b>{entry.rank}</b><span>{entry.username}</span><strong
										>{formatMoneyDisplay(entry.balance)} {selectedGuild.currencyUnit}</strong
									>
								</li>{/each}
						</ol>
					</section>
				{/if}

				<section class="card history-card">
					<div class="history-heading">
						<div>
							<p class="card-label">RECENT ACTIVITY</p>
							<h3>내 거래 이력</h3>
						</div>
						<span>최근 20건</span>
					</div>
					{#if data.transactions.length}
						<ul class="transactions">
							{#each data.transactions as transaction}
								<li>
									<i class:credit={transaction.direction === 'credit'}
										>{transaction.direction === 'credit' ? '↓' : '↑'}</i
									>
									<div>
										<strong>{transactionTitle(transaction)}</strong>
										<time datetime={transaction.createdAt}
											>{formatTransactionTime(transaction.createdAt)}</time
										>
									</div>
									<div class="transaction-values">
										<b class:credit={transaction.direction === 'credit'}
											>{transaction.direction === 'credit' ? '+' : '-'}{formatMoneyDisplay(
												transaction.amount
											)}
											{selectedGuild.currencyUnit}</b
										>
										<small>{formatMoneyDisplay(transaction.balanceAfter)}</small>
									</div>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="history-empty">아직 거래 이력이 없습니다.</p>
					{/if}
				</section>
			</div>
		{/if}
	{/if}
</main>

<ConfirmDialog
	open={transferConfirmationOpen}
	title="송금을 진행할까요?"
	description="송금이 완료되면 바로 상대방의 소지금에 반영됩니다."
	confirmLabel="송금하기"
	onconfirm={submitConfirmedTransfer}
	oncancel={() => (transferConfirmationOpen = false)}
>
	{#if selectedRecipient && selectedGuild}
		<div class="transfer-summary">
			<div><span>받는 사람</span><strong>{selectedRecipient.username}</strong></div>
			<div>
				<span>송금 금액</span><strong>{transferAmount.trim()} {selectedGuild.currencyUnit}</strong>
			</div>
		</div>
	{/if}
</ConfirmDialog>

<style>
	:global(*) {
		box-sizing: border-box;
	}
	:global(body) {
		margin: 0;
		background: #0a0c10;
		color: #f5f6f8;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}
	:global(button),
	:global(input),
	:global(select) {
		font: inherit;
	}
	main {
		max-width: 1180px;
		margin: auto;
		padding: 0 28px 80px;
	}
	header {
		height: 82px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid #20242d;
	}
	.brand,
	.user {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.brand {
		color: #fff;
		text-decoration: none;
		font-weight: 800;
	}
	.mark,
	.server-icon {
		display: grid;
		place-items: center;
		background: #7657ff;
		color: white;
		font-weight: 900;
	}
	.mark {
		width: 32px;
		height: 32px;
		border-radius: 9px;
	}
	.user {
		font-size: 13px;
		color: #aab0bd;
	}
	.ghost,
	button {
		border: 0;
		border-radius: 9px;
		padding: 10px 14px;
		cursor: pointer;
	}
	.ghost {
		background: #171a21;
		color: #cbd0da;
	}
	.admin-button {
		color: #c8beff;
		background: #211b3a;
		border: 1px solid #3b3068;
		border-radius: 8px;
		padding: 8px 11px;
		text-decoration: none;
		font-size: 12px;
		font-weight: 750;
	}
	.hero {
		padding: 15vh 0 8vh;
		max-width: 780px;
	}
	.eyebrow,
	.card-label {
		margin: 0 0 9px;
		color: #858d9d;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.16em;
	}
	.hero h1 {
		font-size: clamp(54px, 8vw, 92px);
		line-height: 0.98;
		letter-spacing: -0.065em;
		margin: 0;
	}
	.lead {
		max-width: 590px;
		color: #9da4b2;
		font-size: 19px;
		line-height: 1.7;
		margin: 28px 0 36px;
	}
	.primary {
		font-weight: 750;
	}
	.primary {
		background: #7657ff;
		color: white;
	}
	.large {
		display: inline-block;
		padding: 14px 21px;
		text-decoration: none;
		border-radius: 11px;
	}
	.context-bar {
		display: flex;
		align-items: end;
		justify-content: space-between;
		padding: 56px 0 28px;
	}
	.context-bar h1 {
		font-size: 36px;
		margin: 0;
		letter-spacing: -0.04em;
	}
	.context-picker {
		width: min(410px, 100%);
	}
	.context-picker label,
	label {
		display: block;
		color: #8e96a5;
		font-size: 12px;
		margin-bottom: 7px;
	}
	.context-picker > div {
		display: flex;
		gap: 8px;
	}
	.context-picker select {
		flex: 1;
	}
	.context-picker button {
		background: #252a34;
		color: #fff;
	}
	.server-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-top: 1px solid #20242d;
		padding: 28px 0;
	}
	.server-identity {
		display: flex;
		align-items: center;
		gap: 15px;
	}
	.server-identity img,
	.server-icon {
		width: 52px;
		height: 52px;
		border-radius: 15px;
	}
	.server-identity h2 {
		margin: 0;
		font-size: 24px;
	}
	.status {
		font-size: 12px;
		color: #e69aaa;
		background: #32171e;
		border: 1px solid #5a2936;
		padding: 8px 11px;
		border-radius: 999px;
	}
	.status i {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #e05f7a;
		margin-right: 5px;
	}
	.status.connected {
		color: #8fd9bc;
		background: #10291f;
		border-color: #1c4736;
	}
	.status.connected i {
		background: #54d49e;
	}
	.dashboard {
		display: grid;
		grid-template-columns: 1.1fr 1fr;
		gap: 16px;
	}
	.card {
		background: #11141a;
		border: 1px solid #222732;
		border-radius: 18px;
		padding: 24px;
	}
	.betting-link {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		color: inherit;
		text-decoration: none;
		background: linear-gradient(120deg, #211a46, #11141a 60%);
	}
	.betting-link h3 {
		margin: 4px 0;
		font-size: 22px;
	}
	.betting-link span {
		color: #838b9b;
		font-size: 12px;
	}
	.betting-link strong {
		color: #a99bff;
		font-size: 13px;
	}
	.balance-card {
		grid-column: 1/-1;
		min-height: 220px;
		display: flex;
		align-items: end;
		justify-content: space-between;
		background: linear-gradient(120deg, #17132b, #11141a 58%);
	}
	.balance-card strong {
		display: block;
		font-size: clamp(54px, 8vw, 86px);
		line-height: 1;
		letter-spacing: -0.06em;
	}
	.balance-card span {
		color: #a697ff;
		font-weight: 800;
	}
	.balance-card > p {
		color: #7f8796;
		font-size: 13px;
		max-width: 240px;
	}
	.reward-card {
		grid-column: 1 / -1;
		background: linear-gradient(120deg, #17213a, #11141a 62%);
	}
	.reward-heading {
		display: flex;
		justify-content: space-between;
		align-items: start;
		gap: 24px;
	}
	.reward-heading h3 {
		margin: 0;
		font-size: 22px;
	}
	.reward-heading p:not(.card-label) {
		margin: 7px 0 0;
		color: #8490a6;
		font-size: 12px;
	}
	.reward-cap {
		display: grid;
		grid-template-columns: auto auto;
		column-gap: 6px;
		align-items: baseline;
		text-align: right;
	}
	.reward-cap span {
		grid-column: 1 / -1;
		color: #8490a6;
		font-size: 11px;
	}
	.reward-cap strong {
		font-size: 25px;
	}
	.reward-cap small {
		color: #9eadff;
		font-weight: 800;
	}
	.voice-rates {
		display: grid;
		grid-template-columns: 1.35fr repeat(4, 1fr);
		gap: 8px;
		margin-top: 22px;
	}
	.voice-rates > div {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: baseline;
		gap: 4px 8px;
		padding: 13px;
		border: 1px solid #29334a;
		border-radius: 10px;
		background: #0d121d;
	}
	.voice-rates span {
		grid-column: 1 / -1;
		color: #8490a6;
		font-size: 11px;
	}
	.voice-rates strong {
		font-size: 18px;
	}
	.voice-rates small {
		color: #8490a6;
		font-size: 10px;
	}
	.voice-rates .featured {
		border-color: #4b5e9a;
		background: #18213a;
	}
	.voice-rates .featured span,
	.voice-rates .featured small {
		color: #aebcff;
	}
	.attendance-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
		min-width: 0;
		background: linear-gradient(120deg, #12251f, #11141a 58%);
	}
	.attendance-grid {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px;
		align-items: stretch;
	}
	.attendance-card h3,
	.attendance-card p {
		margin: 0;
	}
	.attendance-card h3 {
		font-size: 22px;
	}
	.attendance-card p:not(.card-label) {
		margin-top: 7px;
		color: #83978f;
		font-size: 12px;
	}
	.attendance-reward {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		width: 100%;
	}
	.streak-summary {
		display: grid;
		gap: 3px;
		margin-right: 12px;
		color: #83978f;
		font-size: 11px;
	}
	.streak-summary b {
		color: #79dfb7;
	}
	.attendance-reward strong {
		font-size: 28px;
	}
	.attendance-reward > span {
		color: #79dfb7;
		font-size: 12px;
		font-weight: 800;
	}
	.attendance-reward form {
		margin-left: 8px;
	}
	.attendance-reward button {
		background: #277456;
		color: #fff;
		font-weight: 800;
		white-space: nowrap;
	}
	.attendance-reward button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.attendance-ranking-card {
		min-width: 0;
	}
	.attendance-ranking {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
	}
	.attendance-ranking li {
		display: grid;
		grid-template-columns: 26px 1fr auto auto;
		align-items: center;
		gap: 12px;
		padding: 11px 0;
		border-top: 1px solid #252a34;
		font-size: 12px;
	}
	.attendance-ranking li > b {
		color: #8f79ff;
	}
	.attendance-ranking small {
		color: #747d8d;
	}
	.attendance-ranking strong {
		color: #79dfb7;
	}
	.card-title {
		display: flex;
		gap: 13px;
		margin-bottom: 28px;
	}
	.card-title > span {
		color: #7862d8;
		font-size: 12px;
		font-weight: 800;
	}
	.card-title h3,
	.card-title p {
		margin: 0;
	}
	.card-title p {
		color: #7f8796;
		font-size: 13px;
		margin-top: 5px;
	}
	.action-card form {
		display: grid;
		gap: 14px;
	}
	.action-card.full-width {
		grid-column: 1 / -1;
	}
	.action-card button {
		margin-top: 3px;
	}
	.action-card button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.button-row {
		display: grid;
		grid-template-columns: 1fr;
		gap: 8px;
	}
	.ranking {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 8px;
	}
	.ranking li {
		display: grid;
		grid-template-columns: 25px 1fr auto;
		gap: 8px;
		align-items: center;
		padding: 10px;
		background: #0c0e13;
		border-radius: 8px;
		font-size: 13px;
	}
	.ranking b {
		color: #8f79ff;
	}
	.ranking strong {
		font-size: 12px;
	}
	.ranking-card {
		min-height: 320px;
	}
	.history-card {
		grid-column: 1 / -1;
	}
	.history-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 20px;
		margin-bottom: 20px;
	}
	.history-heading h3 {
		margin: 0;
		font-size: 20px;
	}
	.history-heading > span {
		color: #717989;
		font-size: 11px;
	}
	.transactions {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
	}
	.transactions li {
		display: grid;
		grid-template-columns: 38px 1fr auto;
		align-items: center;
		gap: 12px;
		padding: 13px 0;
		border-top: 1px solid #252a34;
	}
	.transactions i {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		color: #ff9fae;
		background: #321923;
		border-radius: 11px;
		font-style: normal;
		font-weight: 850;
	}
	.transactions i.credit {
		color: #79dfb7;
		background: #123126;
	}
	.transactions li > div {
		display: grid;
		gap: 3px;
	}
	.transactions strong {
		font-size: 13px;
	}
	.transactions time {
		color: #747d8d;
		font-size: 11px;
	}
	.transactions b {
		color: #ff9fae;
		font-size: 13px;
	}
	.transactions b.credit {
		color: #79dfb7;
	}
	.transaction-values {
		display: grid;
		justify-items: end;
		gap: 3px;
		font-variant-numeric: tabular-nums;
	}
	.transaction-values small {
		color: #858d9d;
		font-size: 11px;
	}
	.history-empty {
		margin: 0;
		padding: 34px 0;
		color: #747d8d;
		text-align: center;
		font-size: 13px;
		border-top: 1px solid #252a34;
	}
	input,
	select {
		width: 100%;
		height: 44px;
		background: #090b0f;
		color: #eef0f4;
		border: 1px solid #2c323e;
		border-radius: 9px;
		padding: 11px 12px;
	}
	.amount {
		position: relative;
	}
	.amount input {
		padding-right: 70px;
	}
	.amount span {
		position: absolute;
		right: 12px;
		top: 11px;
		color: #7f8796;
		font-size: 13px;
	}
	.member-search {
		position: relative;
	}
	.search-state {
		position: absolute;
		right: 12px;
		top: 36px;
		color: #7f8796;
	}
	.results {
		position: absolute;
		z-index: 5;
		top: 68px;
		left: 0;
		right: 0;
		background: #171a21;
		border: 1px solid #303744;
		border-radius: 10px;
		padding: 5px;
		box-shadow: 0 14px 35px #0008;
	}
	.results button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 10px;
		background: transparent;
		color: #fff;
		text-align: left;
	}
	.results button:hover {
		background: #252a34;
	}
	.results img,
	.results i {
		width: 30px;
		height: 30px;
		border-radius: 50%;
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
	.results i {
		display: grid;
		place-items: center;
		background: #7657ff;
		font-style: normal;
	}
	.notice {
		padding: 12px 16px;
		background: #492029;
		border-radius: 10px;
		margin: 0 0 18px;
	}
	.notice.success {
		background: #153c32;
	}
	.transfer-summary {
		display: grid;
		gap: 1px;
		padding: 1px;
		background: #292e3a;
		border-radius: 12px;
		overflow: hidden;
	}
	.transfer-summary div {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 13px 14px;
		background: #0d1016;
	}
	.transfer-summary span {
		color: #858d9d;
		font-size: 12px;
	}
	.transfer-summary strong {
		color: #f3f1ff;
		font-size: 13px;
		text-align: right;
	}
	.empty {
		text-align: center;
		padding: 18vh 20px;
	}
	.empty-icon {
		display: grid;
		place-items: center;
		width: 60px;
		height: 60px;
		border-radius: 18px;
		background: #7657ff;
		margin: 0 auto 24px;
		font-weight: 900;
	}
	.empty h1 {
		font-size: 34px;
	}
	.empty p {
		color: #858d9d;
	}
	@media (max-width: 760px) {
		main {
			padding: 0 16px 50px;
		}
		.context-bar {
			align-items: stretch;
			flex-direction: column;
			gap: 24px;
		}
		.context-picker {
			width: 100%;
		}
		.dashboard {
			grid-template-columns: 1fr;
		}
		.attendance-grid {
			grid-template-columns: 1fr;
		}
		.reward-heading {
			flex-direction: column;
		}
		.reward-cap {
			text-align: left;
		}
		.voice-rates {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.voice-rates .featured {
			grid-column: 1 / -1;
		}
		.balance-card {
			align-items: start;
			flex-direction: column;
			min-height: 250px;
		}
		.attendance-card,
		.attendance-reward {
			align-items: flex-start;
			flex-direction: column;
		}
		.attendance-ranking li {
			grid-template-columns: 24px 1fr auto;
		}
		.attendance-ranking small {
			display: none;
		}
		.attendance-reward form {
			margin-left: 0;
		}
		.server-heading {
			align-items: flex-start;
			gap: 18px;
		}
		.status {
			white-space: nowrap;
		}
		.user > span {
			display: none;
		}
	}
</style>
