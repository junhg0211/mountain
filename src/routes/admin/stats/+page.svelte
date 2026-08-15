<script lang="ts">
	const { data } = $props();
	type Guild = { id: string; name: string };
	type RankingMember = (typeof data.ranking)[number];
	const selectedGuild = $derived(
		data.guilds.find((guild: Guild) => guild.id === data.selectedGuildId)
	);
	const totalMessages = $derived(
		data.ranking.reduce((sum: number, member: RankingMember) => sum + member.messageCount, 0)
	);
	const totalVoiceSeconds = $derived(
		data.ranking.reduce((sum: number, member: RankingMember) => sum + member.voiceSeconds, 0)
	);
	function formatDuration(seconds: number) {
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const remainingSeconds = seconds % 60;
		if (hours) return `${hours}시간 ${minutes}분 ${remainingSeconds}초`;
		if (minutes) return `${minutes}분 ${remainingSeconds}초`;
		return `${remainingSeconds}초`;
	}
</script>

<svelte:head><title>참여 통계 · Mountain Admin</title></svelte:head>

<main>
	<header><a href="/admin">← 관리자 대시보드</a><span>참여 통계</span></header>
	<section class="heading">
		<div>
			<p>COMMUNITY ACTIVITY</p>
			<h1>서버 참여 순위</h1>
		</div>
		<form method="GET">
			<label
				>서버<select name="guild">
					{#each data.guilds as guild}<option
							value={guild.id}
							selected={guild.id === data.selectedGuildId}>{guild.name}</option
						>{/each}
				</select></label
			>
			<label>시작일<input type="date" name="start" value={data.startDate} /></label>
			<label>종료일<input type="date" name="end" value={data.endDate} /></label>
			<button>조회</button>
		</form>
	</section>

	{#if selectedGuild}
		<section class="summary">
			<article>
				<span>참여 인원</span><strong>{data.ranking.length.toLocaleString()}명</strong>
			</article>
			<article><span>작성 메시지</span><strong>{totalMessages.toLocaleString()}개</strong></article>
			<article><span>음성 참여</span><strong>{formatDuration(totalVoiceSeconds)}</strong></article>
			<article>
				<span>미참여 인원</span><strong
					>{data.memberListAvailable
						? `${data.nonParticipants.length.toLocaleString()}명`
						: '확인 불가'}</strong
				>
			</article>
		</section>
		<section class="card">
			<div class="card-heading">
				<div>
					<span>PARTICIPATION RANKING</span>
					<h2>{selectedGuild.name}</h2>
				</div>
				<small>{data.startDate} ~ {data.endDate}</small>
			</div>
			<p class="description">메시지 1개와 음성 참여 45초를 각각 참여 점수 1점으로 계산합니다.</p>
			{#if data.ranking.length}
				<div class="ranking">
					<div class="row labels">
						<span>순위</span><span>구성원</span><span>메시지</span><span>음성 참여</span><span
							>참여 점수</span
						>
					</div>
					{#each data.ranking as member}
						<article class="row">
							<strong class:medal={member.rank <= 3}>{member.rank}</strong>
							<div class="member">
								{#if member.avatarUrl}<img src={member.avatarUrl} alt="" />{:else}<i
										>{member.username.slice(0, 1)}</i
									>{/if}
								<span><b>{member.username}</b><small>{member.userId}</small></span>
							</div>
							<span>{member.messageCount.toLocaleString()}개</span>
							<span>{formatDuration(member.voiceSeconds)}</span>
							<strong>{member.participationScore.toLocaleString()}점</strong>
						</article>
					{/each}
				</div>
			{:else}<div class="empty">선택한 기간에 기록된 참여 활동이 없습니다.</div>{/if}
		</section>
		<section class="card inactive-card">
			<div class="card-heading">
				<div>
					<span>NO ACTIVITY</span>
					<h2>미참여 구성원</h2>
				</div>
				<small
					>{data.memberListAvailable
						? `${data.nonParticipants.length.toLocaleString()}명`
						: '권한 필요'}</small
				>
			</div>
			<p class="description">
				선택한 기간에 메시지 작성과 음성 참여 기록이 모두 없는 현재 서버 구성원입니다.
			</p>
			{#if !data.memberListAvailable}
				<div class="empty">
					Discord Developer Portal에서 Server Members Intent를 활성화하면 미참여 구성원 목록을
					확인할 수 있습니다.
				</div>
			{:else if data.nonParticipants.length}
				<div class="inactive-grid">
					{#each data.nonParticipants as member}
						<article class="member inactive-member">
							{#if member.avatarUrl}<img src={member.avatarUrl} alt="" />{:else}<i
									>{member.username.slice(0, 1)}</i
								>{/if}
							<span><b>{member.username}</b><small>{member.userId}</small></span>
						</article>
					{/each}
				</div>
			{:else}<div class="empty">선택한 기간에 모든 구성원이 참여했습니다.</div>{/if}
		</section>
	{:else}<div class="empty">관리할 수 있는 서버가 없습니다.</div>{/if}
</main>

<style>
	:global(body) {
		margin: 0;
		background: #080a0e;
		color: #f2f3f5;
		font-family: Inter, Pretendard, system-ui, sans-serif;
	}
	main {
		max-width: 1120px;
		margin: 0 auto;
		padding: 0 28px 70px;
	}
	header {
		height: 66px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid #20252e;
		color: #8f97a6;
	}
	header a {
		color: #a99cff;
		text-decoration: none;
	}
	.heading {
		display: flex;
		justify-content: space-between;
		align-items: end;
		gap: 24px;
		padding: 52px 0 26px;
	}
	.heading p,
	.card-heading span {
		margin: 0;
		color: #816bff;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.15em;
	}
	h1,
	h2 {
		margin: 7px 0 0;
	}
	h1 {
		font-size: clamp(30px, 5vw, 48px);
	}
	.heading form {
		display: grid;
		grid-template-columns: minmax(150px, 1fr) repeat(2, 150px) auto;
		align-items: end;
		gap: 10px;
	}
	label {
		color: #8f97a6;
		font-size: 12px;
	}
	input,
	select,
	button {
		box-sizing: border-box;
		width: 100%;
		height: 42px;
		margin-top: 6px;
		padding: 0 12px;
		border: 1px solid #303744;
		border-radius: 9px;
		background: #0b0d12;
		color: #fff;
		font: inherit;
	}
	button {
		width: auto;
		margin-top: 0;
		background: #7657ff;
		border-color: #7657ff;
		font-weight: 750;
		cursor: pointer;
	}
	.summary {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 14px;
		margin-bottom: 18px;
	}
	.summary article,
	.card {
		border: 1px solid #20252e;
		background: #101319;
		border-radius: 15px;
	}
	.summary article {
		display: grid;
		gap: 8px;
		padding: 20px;
	}
	.summary span,
	.card-heading small,
	.description {
		color: #747d8d;
		font-size: 13px;
	}
	.summary strong {
		font-size: 25px;
	}
	.card {
		padding: 24px;
	}
	.inactive-card {
		margin-top: 18px;
	}
	.card-heading {
		display: flex;
		justify-content: space-between;
		align-items: end;
	}
	.description {
		margin: 8px 0 22px;
	}
	.ranking {
		overflow-x: auto;
	}
	.row {
		min-width: 720px;
		display: grid;
		grid-template-columns: 55px minmax(220px, 1.5fr) repeat(3, minmax(105px, 0.7fr));
		align-items: center;
		gap: 14px;
		padding: 13px 10px;
		border-top: 1px solid #20252e;
	}
	.labels {
		color: #747d8d;
		border-top: 0;
		font-size: 11px;
	}
	.member {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 11px;
	}
	.member img,
	.member i {
		width: 38px;
		height: 38px;
		flex: 0 0 auto;
		border-radius: 50%;
		object-fit: cover;
	}
	.member i {
		display: grid;
		place-items: center;
		background: #27223f;
		color: #b9afff;
		font-style: normal;
	}
	.member span {
		min-width: 0;
		display: grid;
		gap: 3px;
	}
	.member b,
	.member small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.member small {
		color: #747d8d;
		font-size: 10px;
	}
	.medal {
		color: #9f8eff;
		font-size: 20px;
	}
	.inactive-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
		gap: 10px;
	}
	.inactive-member {
		padding: 12px;
		border: 1px solid #20252e;
		border-radius: 11px;
		background: #0b0d12;
	}
	.empty {
		padding: 42px;
		text-align: center;
		color: #747d8d;
		border: 1px dashed #303744;
		border-radius: 14px;
	}
	@media (max-width: 820px) {
		.heading {
			align-items: stretch;
			flex-direction: column;
		}
		.heading form {
			grid-template-columns: 1fr 1fr;
		}
		.heading form label:first-child {
			grid-column: 1 / -1;
		}
		.summary {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 520px) {
		main {
			padding: 0 16px 50px;
		}
		.heading form {
			grid-template-columns: 1fr;
		}
		.heading form label:first-child {
			grid-column: auto;
		}
		button {
			width: 100%;
		}
	}
</style>
