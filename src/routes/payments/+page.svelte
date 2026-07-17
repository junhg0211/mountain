<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	let scheduleType = $state('interval');
	let search = $state('');
	let results = $state<Array<{ id: string; username: string }>>([]);
	let recipient = $state<{ id: string; name: string } | null>(null);
	let timer: ReturnType<typeof setTimeout>;
	function findMembers() {
		clearTimeout(timer); recipient = null;
		if (search.trim().length < 1) { results = []; return; }
		timer = setTimeout(async () => {
			const response = await fetch(`/api/guilds/${data.selectedGuildId}/members?q=${encodeURIComponent(search)}`);
			if (response.ok) results = (await response.json()).members;
		}, 250);
	}
	const date = (value: number) => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(value);
</script>

<svelte:head><title>자동 결제 · Mountain</title></svelte:head>
<main>
	<header><div><a href={`/?guild=${data.selectedGuildId}`}>← 대시보드</a><h1>자동 결제</h1></div></header>
	<nav>{#each data.guilds as guild}<a class:active={guild.id === data.selectedGuildId} href={`?guild=${guild.id}`}>{guild.name}</a>{/each}</nav>
	{#if form?.message}<p class:success={form.success} class="notice">{form.message}</p>{/if}
	{#if data.selectedGuildId}
	<section><h2>색상 역할 구독</h2><p class="warning">가입 즉시 한 달 요금 전액이 결제되고, 이후 매월 1일 12:00(KST)에 결제됩니다. 일할 계산과 환불은 없습니다.</p>
		<div class="cards">{#each data.plans as plan}<article><h3>{plan.name}</h3><p>매월 {plan.monthlyPrice} {data.currencyUnit}</p><form method="POST" action="?/subscribe" use:enhance><input type="hidden" name="guildId" value={data.selectedGuildId}><input type="hidden" name="planId" value={plan.id}><button>구독하기</button></form></article>{/each}</div>
		{#each data.subscriptions as item}<div class="row"><span><b>{item.name}</b> · 매월 {item.monthlyPrice} {data.currencyUnit}<small>{item.status === 'active' ? `다음 결제 ${date(item.nextChargeAt)}` : '해지됨'}</small></span>{#if item.status === 'active'}<form method="POST" action="?/cancelSubscription" use:enhance><input type="hidden" name="guildId" value={data.selectedGuildId}><input type="hidden" name="id" value={item.id}><button class="secondary">해지</button></form>{/if}</div>{/each}
	</section>
	<section><h2>자동 송금 만들기</h2><p>등록할 때는 결제되지 않으며 다음 실행 시각부터 송금합니다. 잔액 부족 회차는 건너뛰고 자동이체는 유지됩니다.</p>
		<form method="POST" action="?/createTransfer" use:enhance class="grid">
			<input type="hidden" name="guildId" value={data.selectedGuildId}><input type="hidden" name="recipientId" value={recipient?.id || ''}>
			<label>받는 사람<input placeholder="서버 닉네임 검색" bind:value={search} oninput={findMembers}></label>
			{#if results.length && !recipient}<div class="results">{#each results as member}<button type="button" onclick={() => { recipient = { id: member.id, name: member.username }; search = member.username; results=[]; }}>{member.username}</button>{/each}</div>{/if}
			<label>금액 ({data.currencyUnit})<input name="amount" inputmode="decimal" placeholder="0.01" required></label>
			<label>주기<select name="scheduleType" bind:value={scheduleType}><option value="interval">N일마다</option><option value="weekly">매주</option><option value="monthly">매월</option></select></label>
			<label>{scheduleType === 'interval' ? '일수 (1~365)' : scheduleType === 'weekly' ? '요일 (일=0, 토=6)' : '날짜 (1~28)'}<input name="scheduleValue" type="number" min="0" required></label>
			<label>시<input name="hour" type="number" min="0" max="23" value="12" required></label><label>분<input name="minute" type="number" min="0" max="59" value="0" required></label>
			<button class="submit-transfer" disabled={!recipient}>자동 송금 등록</button>
		</form>
	</section>
	<section><h2>내 자동 송금</h2>{#each data.transfers as item}<div class="row"><span><b>{item.recipientName}</b>에게 {item.amount} {data.currencyUnit}<small>{item.status === 'active' ? `다음 실행 ${date(item.nextRunAt)}` : '해지됨'} · 누적 {item.totalTransferred} {data.currencyUnit}{item.lastError ? ` · 최근 오류: ${item.lastError}` : ''}</small></span>{#if item.status === 'active'}<form method="POST" action="?/cancelTransfer" use:enhance><input type="hidden" name="guildId" value={data.selectedGuildId}><input type="hidden" name="id" value={item.id}><button class="secondary">해지</button></form>{/if}</div>{:else}<p>등록된 자동 송금이 없습니다.</p>{/each}</section>
	<section><h2>최근 자동 결제 이력</h2>{#each data.runs as run}<div class="row"><span>{run.type === 'scheduled_transfer' ? '자동 송금' : '역할 구독'} · {run.amount} {data.currencyUnit}<small>{new Date(run.createdAt).toLocaleString('ko-KR')} · {run.status === 'success' ? '성공' : `실패 (${run.error})`}</small></span></div>{:else}<p>아직 실행 이력이 없습니다.</p>{/each}</section>
	{/if}
</main>

<style>
	:global(body){margin:0;background:#0d1020;color:#eef0ff;font-family:system-ui}main{max-width:1120px;margin:auto;padding:32px 20px}a{color:#aeb8ff;text-decoration:none}header h1{margin:.4rem 0 1rem}nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}nav a{padding:10px 14px;background:#181d36;border-radius:10px}.active{outline:2px solid #7887ff}section{background:#161a30;border:1px solid #2b3153;border-radius:18px;padding:22px;margin:16px 0}.warning{background:#332b14;color:#ffe39a;padding:14px;border-radius:12px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}.cards article,.row{background:#202641;border-radius:12px;padding:15px}.row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:9px 0}.row small{display:block;color:#aeb3ca;margin-top:5px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;position:relative}.submit-transfer{grid-column:1 / -1;width:100%}label{display:grid;gap:6px;color:#c7cae1}input,select,button{box-sizing:border-box;min-height:46px;border-radius:10px;border:1px solid #3b436d;background:#101429;color:white;padding:0 13px;font:inherit}button{background:#6575f5;border:0;font-weight:700;cursor:pointer}button:disabled{opacity:.45}.secondary{background:#363d61}.results{position:absolute;z-index:3;top:72px;left:0;width:calc(50% - 6px);display:grid;background:#202641;padding:8px;border-radius:10px}.results button{background:transparent;text-align:left}.notice{padding:13px;border-radius:10px;background:#562a37}.notice.success{background:#1d513e}@media(max-width:650px){.grid{grid-template-columns:1fr}.results{width:100%}.row{align-items:flex-start}}
</style>
