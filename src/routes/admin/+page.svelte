<script lang="ts">
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
			`/api/guilds/${selectedGuild.id}/members?q=${encodeURIComponent(memberQuery)}`
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
				<span>총 유통량</span><strong>{data.totalSupply} {selectedGuild.currencyUnit}</strong>
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
				<p>송금, Mint, Burn이 완료되면 선택한 Discord 채널에 기록합니다.</p>
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
	.visibility {
		border-top: 1px solid #292e39;
		padding-top: 26px;
	}
	.notifications {
		border-top: 1px solid #292e39;
		padding-top: 26px;
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
	}
</style>
