<script lang="ts">
	const { data, form } = $props();
</script>

<svelte:head><title>Mountain Economy</title></svelte:head>

<main>
	<header>
		<div>
			<span class="eyebrow">MOUNTAIN</span>
			<h1>Economy dashboard</h1>
		</div>
		{#if data.user}
			<form method="POST" action="?/logout"><button class="ghost">로그아웃</button></form>
		{/if}
	</header>

	{#if !data.user}
		<section class="hero">
			<p class="eyebrow">DISCORD ECONOMY</p>
			<h2>서버 경제를 한곳에서 관리하세요.</h2>
			<p>잔액 확인, 송금, 경제 단위 설정을 웹과 Discord에서 함께 사용할 수 있습니다.</p>
			<a class="primary" href="/login">Discord로 로그인</a>
		</section>
	{:else}
		<section class="welcome">
			<div>
				<p class="eyebrow">SIGNED IN</p>
				<h2>{data.user.username}님의 서버</h2>
			</div>
			<p>봇이 참여한 서버 {data.guilds.length}개</p>
		</section>

		{#if form?.message}<p class:success={form.success} class="notice">{form.message}</p>{/if}

		{#if data.guilds.length === 0}
			<section class="empty">
				<h3>함께 참여 중인 서버가 없습니다.</h3>
				<p>Mountain 봇을 서버에 추가한 뒤 다시 로그인해 주세요.</p>
			</section>
		{:else}
			<div class="grid">
				{#each data.guilds as guild}
					<article>
						<div class="server">
							{#if guild.iconUrl}<img src={guild.iconUrl} alt="" />{:else}<span class="icon"
									>{guild.name.slice(0, 1)}</span
								>{/if}
							<div>
								<h3>{guild.name}</h3>
								<p>서버별 계좌</p>
							</div>
						</div>
						<div class="balance">
							<span>소지금</span><strong>{guild.balance} <small>{guild.currencyUnit}</small></strong
							>
						</div>

						<form method="POST" action="?/transfer" class="panel">
							<input type="hidden" name="guildId" value={guild.id} />
							<label
								>받는 사람<select name="recipientId" required
									><option value="">선택</option
									>{#each data.members.filter((member: { guildId: string }) => member.guildId === guild.id) as member}<option
											value={member.id}>{member.username}</option
										>{/each}</select
								></label
							>
							<label
								>금액<input name="amount" inputmode="decimal" placeholder="0.01" required /></label
							>
							<button class="primary" type="submit">송금하기</button>
						</form>

						{#if guild.canManage}
							<form method="POST" action="?/settings" class="settings">
								<input type="hidden" name="guildId" value={guild.id} />
								<label
									>경제 단위<input
										name="unit"
										value={guild.currencyUnit}
										maxlength="16"
										required
									/></label
								>
								<button type="submit">변경</button>
							</form>
						{/if}
					</article>
				{/each}
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
		background: #0b0d12;
		color: #f7f7f8;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}
	main {
		max-width: 1100px;
		margin: auto;
		padding: 32px 24px 80px;
	}
	header,
	.welcome,
	.server,
	.settings {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}
	h1,
	h2,
	h3,
	p {
		margin: 0;
	}
	h1 {
		font-size: 18px;
	}
	h2 {
		font-size: clamp(28px, 5vw, 48px);
		letter-spacing: -0.04em;
	}
	h3 {
		font-size: 18px;
	}
	.eyebrow {
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.18em;
		color: #8b95a7;
		margin-bottom: 8px;
	}
	.hero {
		margin-top: 15vh;
		max-width: 700px;
	}
	.hero p:not(.eyebrow) {
		margin: 20px 0 32px;
		color: #a8afbc;
		font-size: 18px;
		line-height: 1.6;
	}
	.primary,
	button {
		border: 0;
		border-radius: 10px;
		padding: 11px 16px;
		font-weight: 700;
		cursor: pointer;
	}
	.primary {
		display: inline-block;
		background: #7c5cff;
		color: white;
		text-decoration: none;
	}
	.ghost {
		background: #191d26;
		color: #ddd;
	}
	.welcome {
		margin: 72px 0 28px;
	}
	.welcome > p {
		color: #8b95a7;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(310px, 1fr));
		gap: 18px;
	}
	article,
	.empty {
		background: #12151c;
		border: 1px solid #242936;
		border-radius: 18px;
		padding: 22px;
	}
	.server {
		justify-content: flex-start;
	}
	.server img,
	.icon {
		width: 44px;
		height: 44px;
		border-radius: 14px;
	}
	.icon {
		display: grid;
		place-items: center;
		background: #7c5cff;
		font-weight: 800;
	}
	.server p,
	label,
	.balance span {
		color: #8b95a7;
		font-size: 13px;
	}
	.balance {
		padding: 28px 0;
	}
	.balance strong {
		display: block;
		font-size: 32px;
		margin-top: 6px;
	}
	.balance small {
		font-size: 14px;
		color: #a8afbc;
	}
	.panel {
		display: grid;
		grid-template-columns: 1fr 110px;
		gap: 10px;
	}
	.panel button {
		grid-column: 1/-1;
	}
	.panel label,
	.settings label {
		display: grid;
		gap: 6px;
	}
	.settings {
		margin-top: 18px;
		padding-top: 18px;
		border-top: 1px solid #242936;
	}
	.settings label {
		flex: 1;
	}
	input,
	select {
		width: 100%;
		background: #0b0d12;
		color: white;
		border: 1px solid #303747;
		border-radius: 9px;
		padding: 10px;
	}
	.settings button {
		margin-top: 19px;
		background: #242936;
		color: white;
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
	.empty {
		text-align: center;
		padding: 50px;
	}
	.empty p {
		color: #8b95a7;
		margin-top: 8px;
	}
	@media (max-width: 600px) {
		main {
			padding: 22px 16px;
		}
		.welcome {
			align-items: flex-end;
		}
		.panel {
			grid-template-columns: 1fr;
		}
		.panel button {
			grid-column: auto;
		}
	}
</style>
