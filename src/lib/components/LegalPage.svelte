<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		eyebrow,
		title,
		description,
		effectiveDate,
		children
	}: {
		eyebrow: string;
		title: string;
		description: string;
		effectiveDate: string;
		children: Snippet;
	} = $props();
</script>

<svelte:head><title>{title} · Mountain</title></svelte:head>

<header class="legal-header">
	<a href="/"><span>M</span>Mountain</a>
	<nav><a href="/terms">이용약관</a><a href="/privacy">개인정보처리방침</a></nav>
</header>

<main>
	<section class="intro">
		<p>{eyebrow}</p>
		<h1>{title}</h1>
		<strong>{description}</strong>
		<small>시행일: {effectiveDate}</small>
	</section>
	<article>{@render children()}</article>
</main>

<style>
	:global(*) {
		box-sizing: border-box;
	}
	:global(body) {
		margin: 0;
		color: #eef0f5;
		background: #0a0c10;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}
	.legal-header {
		max-width: 980px;
		height: 82px;
		margin: auto;
		padding: 0 28px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid #20242d;
	}
	.legal-header > a {
		display: flex;
		align-items: center;
		gap: 10px;
		color: #fff;
		font-weight: 850;
		text-decoration: none;
	}
	.legal-header > a span {
		width: 31px;
		height: 31px;
		display: grid;
		place-items: center;
		border-radius: 9px;
		background: #7657ff;
	}
	nav {
		display: flex;
		gap: 18px;
	}
	nav a {
		color: #949cab;
		font-size: 12px;
		text-decoration: none;
	}
	main {
		max-width: 920px;
		margin: auto;
		padding: 76px 28px 90px;
	}
	.intro {
		padding-bottom: 38px;
		border-bottom: 1px solid #252a34;
	}
	.intro p {
		margin: 0 0 12px;
		color: #8d7cff;
		font-size: 11px;
		font-weight: 850;
		letter-spacing: 0.16em;
	}
	.intro h1 {
		margin: 0;
		font-size: clamp(42px, 7vw, 68px);
		letter-spacing: -0.055em;
	}
	.intro strong {
		display: block;
		max-width: 680px;
		margin-top: 20px;
		color: #aab0bd;
		font-size: 16px;
		line-height: 1.7;
		font-weight: 450;
	}
	.intro small {
		display: block;
		margin-top: 18px;
		color: #6f7787;
	}
	article {
		padding-top: 20px;
	}
	:global(article section) {
		padding: 27px 0;
		border-bottom: 1px solid #20242d;
	}
	:global(article h2) {
		margin: 0 0 14px;
		font-size: 20px;
		letter-spacing: -0.02em;
	}
	:global(article h3) {
		margin: 20px 0 8px;
		color: #dfe2e9;
		font-size: 15px;
	}
	:global(article p),
	:global(article li),
	:global(article td),
	:global(article th) {
		color: #9aa2b1;
		font-size: 14px;
		line-height: 1.75;
	}
	:global(article p) {
		margin: 8px 0;
	}
	:global(article ol),
	:global(article ul) {
		margin: 8px 0;
		padding-left: 22px;
	}
	:global(article li + li) {
		margin-top: 7px;
	}
	:global(article a) {
		color: #a99bff;
	}
	:global(article table) {
		width: 100%;
		margin: 14px 0;
		border-collapse: collapse;
	}
	:global(article th),
	:global(article td) {
		padding: 12px;
		text-align: left;
		vertical-align: top;
		border: 1px solid #2a303b;
	}
	:global(article th) {
		color: #d9dce3;
		background: #141820;
		font-size: 12px;
	}
	:global(article .note) {
		padding: 14px 16px;
		border: 1px solid #37305c;
		border-radius: 10px;
		background: #17132b;
	}
	@media (max-width: 640px) {
		.legal-header {
			padding: 0 16px;
		}
		nav {
			gap: 10px;
		}
		main {
			padding: 50px 16px 64px;
		}
		:global(article table) {
			display: block;
			overflow-x: auto;
		}
	}
</style>
