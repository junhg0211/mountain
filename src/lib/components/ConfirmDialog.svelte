<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		open: boolean;
		title: string;
		description?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		children?: Snippet;
		onconfirm: () => void;
		oncancel: () => void;
	};

	let {
		open,
		title,
		description,
		confirmLabel = '확인',
		cancelLabel = '취소',
		children,
		onconfirm,
		oncancel
	}: Props = $props();
	let dialog: HTMLDialogElement;

	$effect(() => {
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});

	function handleBackdrop(event: MouseEvent) {
		if (event.target === dialog) oncancel();
	}
</script>

<dialog
	bind:this={dialog}
	class="confirm-dialog"
	aria-label={title}
	onclick={handleBackdrop}
	oncancel={(event) => {
		event.preventDefault();
		oncancel();
	}}
>
	<div class="accent"><span>✓</span></div>
	<div class="content">
		<p class="eyebrow">PLEASE CONFIRM</p>
		<h2>{title}</h2>
		{#if description}<p class="description">{description}</p>{/if}
		{#if children}<div class="details">{@render children()}</div>{/if}
	</div>
	<div class="actions">
		<button type="button" class="cancel" onclick={oncancel}>{cancelLabel}</button>
		<button type="button" class="confirm" onclick={onconfirm}>{confirmLabel}</button>
	</div>
</dialog>

<style>
	.confirm-dialog {
		width: min(440px, calc(100vw - 32px));
		padding: 0;
		color: #f5f6f8;
		background: #12151c;
		border: 1px solid #303645;
		border-radius: 22px;
		box-shadow:
			0 30px 90px #000c,
			inset 0 1px #ffffff0a;
		overflow: hidden;
	}
	.confirm-dialog::backdrop {
		background: #05060aaf;
		backdrop-filter: blur(8px);
	}
	.accent {
		height: 92px;
		display: grid;
		place-items: end start;
		padding: 0 26px 18px;
		background:
			radial-gradient(circle at 18% 0%, #8d74ff66, transparent 48%),
			linear-gradient(135deg, #211a42, #151722);
		border-bottom: 1px solid #2a2e3a;
	}
	.accent span {
		display: grid;
		place-items: center;
		width: 38px;
		height: 38px;
		color: #fff;
		background: #7657ff;
		border-radius: 12px;
		font-weight: 900;
		box-shadow: 0 8px 24px #7657ff55;
	}
	.content {
		padding: 24px 26px 20px;
	}
	.eyebrow {
		margin: 0 0 8px;
		color: #8f79ff;
		font-size: 10px;
		font-weight: 850;
		letter-spacing: 0.16em;
	}
	h2 {
		margin: 0;
		font-size: 23px;
		letter-spacing: -0.035em;
	}
	.description {
		margin: 9px 0 0;
		color: #929aaa;
		font-size: 13px;
		line-height: 1.55;
	}
	.details {
		margin-top: 20px;
	}
	.actions {
		display: grid;
		grid-template-columns: 1fr 1.35fr;
		gap: 9px;
		padding: 0 26px 26px;
	}
	button {
		height: 44px;
		border: 0;
		border-radius: 10px;
		font: inherit;
		font-size: 13px;
		font-weight: 800;
		cursor: pointer;
	}
	.cancel {
		color: #d4d8e0;
		background: #242832;
	}
	.confirm {
		color: #fff;
		background: #7657ff;
		box-shadow: 0 8px 22px #7657ff3d;
	}
	button:hover {
		filter: brightness(1.1);
	}
	button:focus-visible {
		outline: 2px solid #a797ff;
		outline-offset: 2px;
	}
</style>
