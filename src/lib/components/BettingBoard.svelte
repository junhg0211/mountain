<script lang="ts">
	import { onMount } from 'svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { formatMoneyDisplay } from '$lib/economy/money-display';

	type Participant = { userId: string; username: string; amount: string };
	type Pool = {
		id: string;
		ownerId: string;
		ownerName: string;
		title: string;
		status: 'open' | 'settled' | 'refunded';
		winnerName: string | null;
		totalAmount: string;
		participantCount: number;
		participants: Participant[];
	};

	let {
		initialPools,
		guildId,
		currencyUnit,
		userId,
		canManage
	}: {
		initialPools: Pool[];
		guildId: string;
		currencyUnit: string;
		userId: string;
		canManage: boolean;
	} = $props();
	let pools = $state<Pool[]>([]);
	let confirmationOpen = $state(false);
	let confirmationTitle = $state('');
	let confirmationDescription = $state('');
	let confirmationLabel = $state('확인');
	let pendingForm = $state<HTMLFormElement>();

	$effect(() => {
		pools = initialPools;
	});

	onMount(() => {
		let active = true;
		async function refresh() {
			if (document.hidden) return;
			const response = await fetch(`/api/guilds/${guildId}/bets`);
			if (active && response.ok) pools = (await response.json()).pools;
		}
		const interval = setInterval(refresh, 3_000);
		return () => {
			active = false;
			clearInterval(interval);
		};
	});

	function statusLabel(status: Pool['status']) {
		if (status === 'settled') return '정산 완료';
		if (status === 'refunded') return '환불 완료';
		return '진행 중';
	}

	function askConfirmation(event: SubmitEvent, title: string, description: string, label: string) {
		event.preventDefault();
		pendingForm = event.currentTarget as HTMLFormElement;
		const formData = new FormData(pendingForm);
		const amount = String(formData.get('amount') || '');
		const winner = pendingForm.querySelector<HTMLSelectElement>('select[name="winnerId"]');
		confirmationTitle = title;
		confirmationDescription = amount
			? `${amount} ${currencyUnit}을(를) 겁니다. ${description}`
			: winner?.selectedOptions[0]?.value
				? `${winner.selectedOptions[0].textContent?.trim()}에게 지급합니다. ${description}`
				: description;
		confirmationLabel = label;
		confirmationOpen = true;
	}

	function confirmAction() {
		confirmationOpen = false;
		pendingForm?.submit();
		pendingForm = undefined;
	}
</script>

<section class="betting-board">
	<div class="board-heading">
		<div>
			<p>LIVE BETTING</p>
			<h3>베팅 판</h3>
			<span>참가 현황은 3초마다 자동으로 갱신됩니다.</span>
		</div>
		<form method="POST" action={`?/createBet&guild=${guildId}`} class="create-form">
			<input type="hidden" name="guildId" value={guildId} />
			<input name="title" maxlength="80" placeholder="새 베팅 판 제목" required />
			<button>판 만들기</button>
		</form>
	</div>

	{#if pools.length}
		<div class="pool-list">
			{#each pools as pool}
				<article class:closed={pool.status !== 'open'}>
					<header>
						<div>
							<span class="pool-id">#{pool.id}</span>
							<h4>{pool.title}</h4>
							<small>판 주인 · {pool.ownerName}</small>
						</div>
						<div class="pool-total">
							<span class:open={pool.status === 'open'}>{statusLabel(pool.status)}</span>
							<strong>{formatMoneyDisplay(pool.totalAmount)} {currencyUnit}</strong>
							<small>{pool.participantCount}명 참가</small>
						</div>
					</header>

					{#if pool.participants.length}
						<ul class="participants">
							{#each pool.participants as participant, index}
								<li>
									<b>{index + 1}</b><span>{participant.username}</span><strong
										>{formatMoneyDisplay(participant.amount)} {currencyUnit}</strong
									>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="no-participants">아직 참가자가 없습니다.</p>
					{/if}

					{#if pool.status === 'open'}
						<div class="pool-actions">
							<form
								method="POST"
								action={`?/placeBet&guild=${guildId}`}
								onsubmit={(event) =>
									askConfirmation(
										event,
										`${pool.title}에 베팅할까요?`,
										'입력한 금액이 소지금에서 빠져나가 판돈으로 보관됩니다.',
										'베팅하기'
									)}
							>
								<input type="hidden" name="guildId" value={guildId} />
								<input type="hidden" name="poolId" value={pool.id} />
								<div class="amount-input">
									<input name="amount" inputmode="decimal" placeholder="0.01" required />
									<span>{currencyUnit}</span>
								</div>
								<button>베팅하기</button>
							</form>

							{#if pool.ownerId === userId || canManage}
								<div class="owner-actions">
									<form
										method="POST"
										action={`?/settleBet&guild=${guildId}`}
										onsubmit={(event) =>
											askConfirmation(
												event,
												'베팅 판을 정산할까요?',
												`${formatMoneyDisplay(pool.totalAmount)} ${currencyUnit} 전부가 선택한 승자에게 지급되며 되돌릴 수 없습니다.`,
												'정산하기'
											)}
									>
										<input type="hidden" name="guildId" value={guildId} />
										<input type="hidden" name="poolId" value={pool.id} />
										<select name="winnerId" required disabled={!pool.participants.length}>
											<option value="">승자 선택</option>
											{#each pool.participants as participant}<option value={participant.userId}
													>{participant.username} · {formatMoneyDisplay(participant.amount)}
													{currencyUnit}</option
												>{/each}
										</select>
										<button class="settle" disabled={!pool.participants.length}
											>승자에게 몰아주기</button
										>
									</form>
									<form
										method="POST"
										action={`?/refundBet&guild=${guildId}`}
										onsubmit={(event) =>
											askConfirmation(
												event,
												'모든 베팅을 환불할까요?',
												`${pool.participantCount}명에게 각자 건 금액을 돌려주고 판을 종료합니다.`,
												'모두 환불'
											)}
									>
										<input type="hidden" name="guildId" value={guildId} />
										<input type="hidden" name="poolId" value={pool.id} />
										<button class="refund">모두에게 환불</button>
									</form>
								</div>
							{/if}
						</div>
					{:else if pool.status === 'settled'}
						<p class="result">🏆 {pool.winnerName}님이 판돈을 받았습니다.</p>
					{:else}
						<p class="result">↩ 참가자 전원에게 베팅액을 돌려줬습니다.</p>
					{/if}
				</article>
			{/each}
		</div>
	{:else}
		<div class="empty">열린 베팅 판이 없습니다. 첫 판을 만들어 보세요.</div>
	{/if}
</section>

<ConfirmDialog
	open={confirmationOpen}
	title={confirmationTitle}
	description={confirmationDescription}
	confirmLabel={confirmationLabel}
	onconfirm={confirmAction}
	oncancel={() => {
		confirmationOpen = false;
		pendingForm = undefined;
	}}
/>

<style>
	.betting-board {
		grid-column: 1 / -1;
		padding: 24px;
		background: #11141a;
		border: 1px solid #222732;
		border-radius: 18px;
	}
	.board-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 24px;
		margin-bottom: 20px;
	}
	.board-heading p {
		margin: 0 0 7px;
		color: #8f79ff;
		font-size: 10px;
		font-weight: 850;
		letter-spacing: 0.16em;
	}
	.board-heading h3 {
		margin: 0 0 6px;
		font-size: 22px;
	}
	.board-heading span {
		color: #747d8d;
		font-size: 12px;
	}
	.create-form,
	.pool-actions form {
		display: flex;
		gap: 8px;
	}
	input,
	select,
	button {
		height: 42px;
		box-sizing: border-box;
		border: 1px solid #303744;
		border-radius: 9px;
		font: inherit;
	}
	input,
	select {
		min-width: 0;
		padding: 10px 12px;
		color: #fff;
		background: #090b0f;
	}
	button {
		padding: 0 14px;
		color: #fff;
		background: #7657ff;
		font-size: 12px;
		font-weight: 800;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.pool-list {
		display: grid;
		gap: 12px;
	}
	article {
		padding: 18px;
		background: #0c0f14;
		border: 1px solid #292e39;
		border-radius: 14px;
	}
	article.closed {
		opacity: 0.72;
	}
	article > header {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 20px;
	}
	.pool-id {
		color: #8f79ff;
		font-size: 11px;
		font-weight: 800;
	}
	h4 {
		margin: 4px 0;
		font-size: 17px;
	}
	article small {
		color: #747d8d;
	}
	.pool-total {
		display: grid;
		justify-items: end;
		gap: 4px;
	}
	.pool-total > span {
		color: #b8bec9;
		font-size: 10px;
		font-weight: 800;
	}
	.pool-total > span.open {
		color: #71dab0;
	}
	.participants {
		list-style: none;
		padding: 0;
		margin: 16px 0 0;
		display: grid;
	}
	.participants li {
		display: grid;
		grid-template-columns: 24px 1fr auto;
		gap: 8px;
		padding: 9px 0;
		border-top: 1px solid #242933;
		font-size: 12px;
	}
	.participants b {
		color: #8f79ff;
	}
	.no-participants,
	.result {
		margin: 16px 0 0;
		padding: 14px;
		color: #858d9d;
		background: #11151c;
		border-radius: 9px;
		font-size: 12px;
		text-align: center;
	}
	.pool-actions {
		display: grid;
		gap: 10px;
		margin-top: 16px;
		padding-top: 14px;
		border-top: 1px solid #292e39;
	}
	.pool-actions > form .amount-input {
		flex: 1;
	}
	.amount-input {
		position: relative;
	}
	.amount-input input {
		width: 100%;
		padding-right: 70px;
	}
	.amount-input span {
		position: absolute;
		right: 11px;
		top: 13px;
		color: #747d8d;
		font-size: 11px;
	}
	.owner-actions {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
	}
	.owner-actions > form:first-child select {
		flex: 1;
	}
	.settle {
		background: #276e54;
	}
	.refund {
		background: #703143;
	}
	.empty {
		padding: 36px 20px;
		color: #747d8d;
		text-align: center;
		font-size: 13px;
		border: 1px dashed #303744;
		border-radius: 12px;
	}
	@media (max-width: 720px) {
		.board-heading,
		article > header {
			align-items: stretch;
			flex-direction: column;
		}
		.create-form,
		.pool-actions form,
		.owner-actions {
			grid-template-columns: 1fr;
			flex-direction: column;
		}
		.pool-total {
			justify-items: start;
		}
		.owner-actions {
			display: grid;
		}
	}
</style>
