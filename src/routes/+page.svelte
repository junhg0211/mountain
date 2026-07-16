<script lang="ts">
	const { data, form } = $props();
	const selectedGuild = $derived(
		data.guilds.find((guild: { id: string }) => guild.id === data.selectedGuildId)
	);
	const contextMembers = $derived(
		data.members.filter((member: { guildId: string }) => member.guildId === data.selectedGuildId)
	);
</script>

<svelte:head><title>Mountain Economy</title></svelte:head>

<main>
	<header>
		<a class="brand" href="/"><span class="mark">M</span><span>Mountain</span></a>
		{#if data.user}
			<div class="user">
				<span>{data.user.username}</span>
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
					<form method="POST" action={`?/transfer&guild=${selectedGuild.id}`}>
						<input type="hidden" name="guildId" value={selectedGuild.id} />
						<label
							>받는 사람<select name="recipientId" required
								><option value="">사용자 선택</option>{#each contextMembers as member}<option
										value={member.id}>{member.username}</option
									>{/each}</select
							></label
						>
						<label
							>금액
							<div class="amount">
								<input name="amount" inputmode="decimal" placeholder="0.01" required /><span
									>{selectedGuild.currencyUnit}</span
								>
							</div></label
						>
						<button class="primary" type="submit">송금하기</button>
					</form>
				</section>

				<section class="card action-card" class:locked={!selectedGuild.canManage}>
					<div class="card-title">
						<span>02</span>
						<div>
							<h3>경제 설정</h3>
							<p>이 서버에서 사용할 단위를 관리합니다.</p>
						</div>
					</div>
					{#if selectedGuild.canManage}
						<form method="POST" action={`?/settings&guild=${selectedGuild.id}`}>
							<input type="hidden" name="guildId" value={selectedGuild.id} />
							<label
								>경제 단위<input
									name="unit"
									value={selectedGuild.currencyUnit}
									maxlength="16"
									required
								/></label
							>
							<button class="secondary" type="submit">설정 저장</button>
						</form>
					{:else}<div class="permission">
							<span>🔒</span>
							<p>서버 관리 권한이 있는 사용자만 변경할 수 있습니다.</p>
						</div>{/if}
				</section>
			</div>
		{/if}
	{/if}
</main>

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
	.primary,
	.secondary {
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
	.context-picker button,
	.secondary {
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
	input,
	select {
		width: 100%;
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
	.locked {
		opacity: 0.82;
	}
	.permission {
		min-height: 125px;
		display: grid;
		place-items: center;
		text-align: center;
		color: #858d9d;
		font-size: 13px;
	}
	.permission p {
		max-width: 250px;
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
