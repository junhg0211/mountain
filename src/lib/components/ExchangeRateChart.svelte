<script lang="ts">
	type Candle = { label: string; open: string; high: string; low: string; close: string };
	let { candles, currencyCode, currencyUnit }: { candles: Candle[]; currencyCode: string; currencyUnit: string } = $props();
	const width = 760;
	const height = 220;
	const padding = 24;
	let values = $derived(candles.flatMap((candle) => [Number(candle.high), Number(candle.low)]));
	let min = $derived(Math.min(...values));
	let max = $derived(Math.max(...values));
	let span = $derived(max - min || Math.max(max * 0.1, 1));
	function y(value: string) { return padding + ((max - Number(value)) / span) * (height - padding * 2); }
	function x(index: number) { return padding + ((index + .5) / candles.length) * (width - padding * 2); }
</script>

<section class="chart" aria-label="Exchange-rate candlestick chart">
	<div><span>EXCHANGE RATE HISTORY</span><h3>환율 캔들스틱</h3><small>장부상 준비금과 전체 유통량을 기반으로 한 시간별 환율입니다.</small></div>
	{#if candles.length >= 1}
		<svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${currencyCode}/${currencyUnit} exchange rate history`}>
			<line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} class="axis" />
			{#each candles as candle, index}
				{@const rising = Number(candle.close) >= Number(candle.open)}
				{@const center = x(index)}
				{@const bodyTop = Math.min(y(candle.open), y(candle.close))}
				{@const bodyHeight = Math.max(2, Math.abs(y(candle.open) - y(candle.close)))}
				<line x1={center} x2={center} y1={y(candle.high)} y2={y(candle.low)} class:rising class:falling={!rising} class="wick" />
				<rect x={center - Math.max(2, (width - padding * 2) / candles.length / 3)} y={bodyTop} width={Math.max(4, (width - padding * 2) / candles.length * .66)} height={bodyHeight} class:rising class:falling={!rising} class="body" />
			{/each}
		</svg>
		<div class="legend"><span>{candles[0].label} KST</span><span>{candles[candles.length - 1].label} KST</span><b>최근 {candles[candles.length - 1].close} {currencyCode}/{currencyUnit}</b></div>
	{:else}<p class="empty">준비금 장부 변동이 쌓이면 여기에 환율 캔들스틱이 표시됩니다.</p>{/if}
</section>

<style>
	.chart { grid-column: 1 / -1; }
	.chart h3 { margin: 5px 0; font-size: 21px; }
	.chart > div:first-child > span { color: #79d7b5; font-size: 10px; font-weight: 800; letter-spacing: .15em; }
	.chart small, .empty { color: #8995a4; font-size: 12px; }
	svg { display: block; width: 100%; height: auto; margin-top: 16px; padding: 12px; background: #0c1312; border: 1px solid #25453b; border-radius: 10px; }
	.axis { stroke: #345348; stroke-width: 1; }
	.wick { stroke-width: 2; }
	.body.rising, .wick.rising { fill: #69d7ae; stroke: #69d7ae; }
	.body.falling, .wick.falling { fill: #e57d91; stroke: #e57d91; }
	.legend { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; color: #8995a4; font-size: 11px; }
	.legend b { color: #d8f0e5; font-variant-numeric: tabular-nums; }
	.empty { margin: 16px 0 0; padding: 18px; border: 1px dashed #315648; border-radius: 9px; }
</style>
