<script lang="ts">
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

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
</script>

<svelte:head><title>Mountain Economy</title></svelte:head>

<main>
	<header>
		<a class="brand" href="/"><span class="mark">M</span><span>Mountain</span></a>
		{#if data.user}
			<div class="user">
				<span>{data.user.username}</span>
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

		{#if form?.message}<p class:success={form.success} class="notice">{form.message}</p>{/if}

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
				<span class="status"><i></i> 봇 연결됨</span>
			</section>

			<div class="dashboard">
				<section class="card balance-card">
					<div>
						<p class="card-label">내 소지금</p>
						<strong>{selectedGuild.balance}</strong><span>{selectedGuild.currencyUnit}</span>
					</div>
					<p>이 잔액은 현재 선택한 서버에서만 사용됩니다.</p>
				</section>

				<section class="card action-card">
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
										>{entry.balance} {selectedGuild.currencyUnit}</strong
									>
								</li>{/each}
						</ol>
					</section>
				{/if}
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
		color: #8fd9bc;
		background: #10291f;
		border: 1px solid #1c4736;
		padding: 8px 11px;
		border-radius: 999px;
	}
	.status i {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #54d49e;
		margin-right: 5px;
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
		.balance-card {
			align-items: start;
			flex-direction: column;
			min-height: 250px;
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
