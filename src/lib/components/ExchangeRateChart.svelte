<script lang="ts">
	import { onMount } from 'svelte';
	import type { IChartApi, UTCTimestamp } from 'lightweight-charts';

	type Candle = {
		time: number;
		label: string;
		open: string;
		high: string;
		low: string;
		close: string;
	};
	let {
		candles,
		currencyCode,
		currencyUnit
	}: { candles: Candle[]; currencyCode: string; currencyUnit: string } = $props();
	let container = $state<HTMLDivElement>();

	onMount(() => {
		if (!candles.length) return;
		let chart: IChartApi | undefined;
		let disposed = false;
		void import('lightweight-charts').then(({ CandlestickSeries, ColorType, createChart }) => {
			if (disposed || !container) return;
			chart = createChart(container, {
				autoSize: true,
				height: 280,
				layout: {
					background: { type: ColorType.Solid, color: '#0c1312' },
					textColor: '#99a9a3',
					fontFamily: 'Inter, system-ui, sans-serif'
				},
				grid: { vertLines: { color: '#17352c' }, horzLines: { color: '#17352c' } },
				rightPriceScale: { borderColor: '#315448' },
				timeScale: { borderColor: '#315448', timeVisible: true, secondsVisible: false }
			});
			const series = chart.addSeries(CandlestickSeries, {
				upColor: '#69d7ae',
				downColor: '#e57d91',
				borderVisible: false,
				wickUpColor: '#69d7ae',
				wickDownColor: '#e57d91',
				priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 }
			});
			series.setData(
				candles.map((candle) => ({
					time: candle.time as UTCTimestamp,
					open: Number(candle.open),
					high: Number(candle.high),
					low: Number(candle.low),
					close: Number(candle.close)
				}))
			);
			chart.timeScale().fitContent();
		});
		return () => {
			disposed = true;
			chart?.remove();
		};
	});
</script>

<section class="chart" aria-label="Exchange-rate candlestick chart">
	<div><span>EXCHANGE RATE HISTORY</span><h3>환율 캔들스틱</h3><small>장부상 준비금과 전체 유통량을 기반으로 한 시간별 환율입니다.</small></div>
	{#if candles.length}
		<div bind:this={container} class="chart-canvas" aria-label={`${currencyCode}/${currencyUnit} exchange-rate chart`}></div>
		<div class="legend"><span>{candles[0].label} KST</span><span>{candles[candles.length - 1].label} KST</span><b>최근 {candles[candles.length - 1].close} {currencyCode}/{currencyUnit}</b></div>
		<a class="attribution" href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer">Powered by TradingView Lightweight Charts™</a>
	{:else}<p class="empty">준비금 장부 변동이 쌓이면 여기에 환율 캔들스틱이 표시됩니다.</p>{/if}
</section>

<style>
	.chart { grid-column: 1 / -1; }
	.chart h3 { margin: 5px 0; font-size: 21px; }
	.chart > div:first-child > span { color: #79d7b5; font-size: 10px; font-weight: 800; letter-spacing: .15em; }
	.chart small, .empty { color: #8995a4; font-size: 12px; }
	.chart-canvas { min-height: 280px; margin-top: 16px; overflow: hidden; border: 1px solid #25453b; border-radius: 10px; }
	.legend { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; color: #8995a4; font-size: 11px; }
	.legend b { color: #d8f0e5; font-variant-numeric: tabular-nums; }
	.attribution { display: inline-block; margin-top: 8px; color: #75958a; font-size: 10px; }
	.empty { margin: 16px 0 0; padding: 18px; border: 1px dashed #315648; border-radius: 9px; }
</style>
