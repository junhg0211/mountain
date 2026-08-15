<script lang="ts">
	let { data, form } = $props();
	const columns = 40;
	const rows = 24;
	let building = $state(false);
	let start = $state<{ x: number; y: number } | null>(null);
	let end = $state<{ x: number; y: number } | null>(null);

	function cell(event: PointerEvent) {
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		return {
			x: Math.max(0, Math.min(columns - 1, Math.floor(((event.clientX - rect.left) / rect.width) * columns))),
			y: Math.max(0, Math.min(rows - 1, Math.floor(((event.clientY - rect.top) / rect.height) * rows)))
		};
	}

	function beginRoom(event: PointerEvent) {
		if (!building || event.button !== 0) return;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		start = cell(event);
		end = start;
	}

	function resizeRoom(event: PointerEvent) {
		if (!building || !start || !(event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId))
			return;
		end = cell(event);
	}

	function finishRoom(event: PointerEvent) {
		if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId))
			(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
	}

	function cancelDraft() {
		start = null;
		end = null;
	}

	const draft = $derived.by(() => {
		if (!start || !end) return null;
		const x = Math.min(start.x, end.x);
		const y = Math.min(start.y, end.y);
		return { x, y, width: Math.abs(start.x - end.x) + 1, height: Math.abs(start.y - end.y) + 1 };
	});

	function roomStyle(room: { x: number; y: number; width: number; height: number }) {
		return `left:${(room.x / columns) * 100}%;top:${(room.y / rows) * 100}%;width:${(room.width / columns) * 100}%;height:${(room.height / rows) * 100}%`;
	}
</script>

<svelte:head><title>Mountain Basecamp</title></svelte:head>

<main>
	<header>
		<a class="brand" href="/"><span>M</span>Mountain Basecamp</a>
		{#if data.guilds.length}
			<nav aria-label="서버 선택">
				{#each data.guilds as guild}
					<a class:active={guild.id === data.guildId} href={`/world?guild=${guild.id}`}>{guild.name}</a>
				{/each}
			</nav>
		{/if}
	</header>

	{#if !data.guildId}
		<section class="empty"><h1>입장할 수 있는 서버가 없습니다</h1><p>Mountain 봇이 있는 Discord 서버에 먼저 참여해 주세요.</p></section>
	{:else}
		<section class="intro">
			<div><small>SERVER WORLD</small><h1>같은 화면에서 걷고, 바로 공간을 바꿉니다.</h1></div>
			{#if data.canManage}
				<button class:active={building} onclick={() => { building = !building; cancelDraft(); }}>
					{building ? '공사 도구 내려놓기' : '방 만들기'}
				</button>
			{/if}
		</section>

		{#if form?.message}<p class:success={form.success} class="notice">{form.message}</p>{/if}

		{#if data.canManage && (!data.settings?.categoryId || !data.settings?.accessRoleId)}
			<form class="setup" method="POST" action="?/configure">
				<input type="hidden" name="guildId" value={data.guildId} />
				<div><strong>Discord 연결부터 설정해 주세요</strong><p>새 방의 음성 채널을 만들 카테고리와, 방에서 발언할 월드 접속자 역할입니다.</p></div>
				<label>카테고리<select name="categoryId" required><option value="">선택</option>{#each data.categories as category}<option value={category.id}>{category.name}</option>{/each}</select></label>
				<label>접속자 역할<select name="accessRoleId" required><option value="">선택</option>{#each data.roles as role}<option value={role.id}>@{role.name}</option>{/each}</select></label>
				<button>연결 설정 저장</button>
			</form>
		{/if}

		<div class="workspace">
			<div class="world-wrap">
				<div
					class:building
					class="world"
					role="application"
					aria-label="월드 공간"
					onpointerdown={beginRoom}
					onpointermove={resizeRoom}
					onpointerup={finishRoom}
				>
					<div class="plaza"><span>WORLD PLAZA</span>{#if data.settings?.lobbyChannelId}<small>🔊 월드 광장</small>{/if}</div>
					{#each data.rooms as room}
						<div class:failed={room.status === 'failed'} class="room" style={roomStyle(room)}>
							<span>{room.name}</span><small>{room.status === 'active' ? 'VOICE' : room.status}</small>
						</div>
					{/each}
					{#if draft}<div class:invalid={draft.width < 2 || draft.height < 2} class="room draft" style={roomStyle(draft)}><span>새 방</span><small>{draft.width} × {draft.height}</small></div>{/if}
					<div class="avatar" title={data.user.username}><span>{data.user.username.slice(0, 1).toUpperCase()}</span></div>
				</div>
				<p class="hint">{building ? '빈 공간을 드래그해서 방을 그려 보세요.' : '월드 안에서 방을 만들고 Discord 음성 공간으로 연결할 수 있습니다.'}</p>
			</div>

			<aside>
				{#if draft && data.canManage}
					<form method="POST" action="?/createRoom">
						<input type="hidden" name="guildId" value={data.guildId} />
						<input type="hidden" name="x" value={draft.x} /><input type="hidden" name="y" value={draft.y} />
						<input type="hidden" name="width" value={draft.width} /><input type="hidden" name="height" value={draft.height} />
						<small>새로운 공간</small><h2>방 확정하기</h2>
						<label>방 이름<input name="name" maxlength="80" placeholder="예: 라운지" required /></label>
						<p>확정하면 <strong>{data.categories.find((item) => item.id === data.settings?.categoryId)?.name || '설정한 카테고리'}</strong>에 같은 이름의 음성 채널이 생성됩니다.</p>
						<button disabled={draft.width < 2 || draft.height < 2 || !data.settings?.categoryId}>방과 채널 만들기</button>
						<button class="secondary" type="button" onclick={cancelDraft}>취소</button>
					</form>
				{:else}
					<div class="guide"><small>IN-WORLD BUILDING</small><h2>화면을 벗어나지 않고 건축하세요.</h2><p>방 만들기를 누른 다음 월드 위에서 원하는 크기만큼 드래그하세요. Discord 채널은 방을 확정할 때 함께 만들어집니다.</p><ul><li>최소 크기 2 × 2</li><li>기존 방과 겹칠 수 없음</li><li>서버당 최대 50개</li></ul></div>
				{/if}
			</aside>
		</div>
	{/if}
</main>

<style>
	:global(body){margin:0;background:#0a0d12;color:#f4f2ea;font-family:Inter,ui-sans-serif,system-ui,sans-serif}main{min-height:100vh;padding:28px;box-sizing:border-box;background:radial-gradient(circle at 50% 0,#23372d 0,transparent 34%)}header,.intro,.workspace{max-width:1280px;margin:auto}header{display:flex;align-items:center;justify-content:space-between;gap:24px}.brand{display:flex;align-items:center;gap:10px;color:#fff;font-weight:850;text-decoration:none}.brand span{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#d6ff66;color:#17200d}nav{display:flex;gap:8px;overflow:auto}nav a{padding:8px 12px;border-radius:999px;color:#899187;text-decoration:none;font-size:12px;white-space:nowrap}nav a.active{background:#26312a;color:#e5f2dc}.intro{display:flex;align-items:end;justify-content:space-between;gap:20px;padding:70px 0 28px}.intro small,.guide>small,aside form>small{color:#b4d75c;font-size:10px;font-weight:900;letter-spacing:.16em}.intro h1{max-width:680px;margin:8px 0 0;font-size:clamp(28px,4vw,52px);line-height:1.04}.intro button,.setup button,aside button{border:0;border-radius:12px;background:#d6ff66;color:#15200c;padding:12px 16px;font:inherit;font-weight:850;cursor:pointer}.intro button.active{background:#ffcf72}.notice{max-width:1240px;margin:0 auto 18px;padding:12px 16px;border:1px solid #663d3d;border-radius:12px;background:#2a1717;color:#ffb6b6;font-size:13px}.notice.success{border-color:#405e38;background:#172619;color:#bfeab6}.setup{max-width:1240px;margin:0 auto 18px;padding:16px 18px;display:grid;grid-template-columns:1fr auto auto auto;align-items:end;gap:14px;border:1px solid #39433a;border-radius:16px;background:#171c18}.setup strong{font-size:14px}.setup p{margin:4px 0 0;color:#8f978e;font-size:11px}.setup label,aside label{display:grid;gap:6px;color:#aeb5ac;font-size:11px}.setup select,aside input{min-width:180px;border:1px solid #3a423b;border-radius:9px;background:#0f1310;color:#fff;padding:10px;font:inherit}.workspace{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:18px}.world-wrap{min-width:0}.world{position:relative;aspect-ratio:5/3;overflow:hidden;border:1px solid #354039;border-radius:20px;background-color:#1a251d;background-image:linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px);background-size:2.5% 4.1667%;box-shadow:0 24px 80px #0008;touch-action:none;user-select:none}.world.building{cursor:crosshair}.plaza{position:absolute;inset:8%;display:grid;place-content:center;justify-items:center;gap:8px;border:1px dashed #44594b;border-radius:50%;color:#ffffff13;font-size:clamp(20px,5vw,68px);font-weight:950;letter-spacing:.15em}.plaza small{color:#9fb09f;font-size:9px;letter-spacing:.08em}.room{position:absolute;display:grid;place-content:center;min-width:0;box-sizing:border-box;border:3px solid #a3c963;border-radius:8px;background:#4b613fcc;color:#fff;text-align:center;pointer-events:none;box-shadow:inset 0 0 0 3px #162119}.room span{overflow:hidden;padding:0 5px;font-size:12px;font-weight:850;text-overflow:ellipsis;white-space:nowrap}.room small{color:#d6ff86;font-size:8px;font-weight:900;letter-spacing:.12em}.room.failed{border-color:#a55b5b;background:#572e2ecc}.room.draft{z-index:3;border-style:dashed;background:#d6ff6633}.room.draft.invalid{border-color:#ff7d7d;background:#ff5d5d22}.avatar{position:absolute;z-index:4;left:49%;top:62%;display:grid;place-items:center;width:30px;height:30px;border:3px solid #f8f2da;border-radius:50%;background:#ee796b;color:#fff;font-size:12px;font-weight:900;box-shadow:0 8px 15px #0008}.hint{margin:10px 4px 0;color:#788279;font-size:11px}aside{border:1px solid #2e3730;border-radius:18px;background:#141916;padding:20px}aside h2{margin:8px 0 12px;font-size:20px}aside p,aside li{color:#8f978f;font-size:12px;line-height:1.65}aside form{display:grid;gap:12px}aside form p{margin:0}aside button:disabled{cursor:not-allowed;opacity:.4}aside button.secondary{background:#282f29;color:#b8c0b8}.guide ul{padding-left:18px}.empty{max-width:720px;margin:120px auto;text-align:center}.empty p{color:#899187}@media(max-width:900px){main{padding:16px}.intro{padding-top:48px;align-items:flex-start;flex-direction:column}.workspace{grid-template-columns:1fr}.setup{grid-template-columns:1fr 1fr}.setup>div{grid-column:1/-1}}@media(max-width:600px){header{align-items:flex-start;flex-direction:column}.setup{grid-template-columns:1fr}.world{min-width:720px}.world-wrap{overflow-x:auto}.hint{position:sticky;left:0}.intro h1{font-size:30px}}
</style>
