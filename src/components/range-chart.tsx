'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    CandlestickSeries,
    type IChartApi,
    type IPriceLine,
    type ISeriesApi,
    type ISeriesMarkersPluginApi,
    LineStyle,
    type SeriesMarker,
    type Time,
    createChart,
    createSeriesMarkers,
} from 'lightweight-charts';
import type { RangeTrade, TradingRange } from '@/lib/range/range-engine';
import { getTimeframeMs, type Candle, type Timeframe } from '@/lib/trading/types';

const LONG_GREEN = '#00d26a';
const SHORT_RED = '#ff4757';
/** Candles shown when a market first loads; the rest are a scroll away. */
const INITIAL_VISIBLE_CANDLES = 320;

interface RangeChartProps {
    candles: readonly Candle[];
    timeframe: Timeframe;
    ranges: readonly TradingRange[];
    trades: readonly RangeTrade[];
    openTrade: RangeTrade | null;
}

interface ZoneBox {
    key: string;
    left: number;
    top: number;
    width: number;
    height: number;
    supply: boolean;
    live: boolean;
    label: string | null;
}

function toChartTime(milliseconds: number): Time {
    return (milliseconds / 1000) as Time;
}

function buildMarkers(trades: readonly RangeTrade[], timeframe: Timeframe): SeriesMarker<Time>[] {
    const duration = getTimeframeMs(timeframe);
    const markers = trades.flatMap((trade): SeriesMarker<Time>[] => {
        const long = trade.direction === 'LONG';
        const entry: SeriesMarker<Time> = {
            time: toChartTime(trade.openedAt),
            position: long ? 'belowBar' : 'aboveBar',
            shape: long ? 'arrowUp' : 'arrowDown',
            color: long ? LONG_GREEN : SHORT_RED,
            text: long ? 'Long' : 'Short',
        };
        if (!trade.outcome || trade.closedAt === undefined) return [entry];

        const won = trade.outcome === 'WIN';
        return [entry, {
            // closedAt is the close of the candle that settled the trade.
            time: toChartTime(trade.closedAt - duration),
            // A long exits upward at its target and downward at its stop.
            position: long === won ? 'aboveBar' : 'belowBar',
            shape: 'circle',
            color: won ? LONG_GREEN : SHORT_RED,
            text: won ? 'Target' : 'Stop',
        }];
    });
    return markers.sort((first, second) => (first.time as number) - (second.time as number));
}

export default function RangeChart({ candles, timeframe, ranges, trades, openTrade }: RangeChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const priceLinesRef = useRef<IPriceLine[]>([]);
    const frameRef = useRef<number | null>(null);
    const rangesRef = useRef(ranges);
    const lastMarketRef = useRef('');
    const [boxes, setBoxes] = useState<ZoneBox[]>([]);

    const layoutZones = useCallback(() => {
        const chart = chartRef.current;
        const series = seriesRef.current;
        const container = containerRef.current;
        if (!chart || !series || !container) return;

        const plotWidth = chart.timeScale().width();
        const next: ZoneBox[] = [];
        rangesRef.current.forEach((range, index) => {
            const live = range.endedAt === undefined;
            for (const zone of [range.top, range.bottom]) {
                const near = series.priceToCoordinate(zone.proximalLine);
                const far = series.priceToCoordinate(zone.distalLine);
                const start = chart.timeScale().timeToCoordinate(toChartTime(zone.createdAt));
                const end = live
                    ? plotWidth
                    : chart.timeScale().timeToCoordinate(toChartTime((range.endedAt ?? 0) - getTimeframeMs(timeframe)));
                if (near === null || far === null || start === null || end === null) continue;

                const left = Math.max(0, start);
                const right = Math.min(plotWidth, end);
                if (right <= left) continue;
                next.push({
                    key: `${index}-${zone.type}`,
                    left,
                    top: Math.min(near, far),
                    width: right - left,
                    height: Math.max(2, Math.abs(near - far)),
                    supply: zone.type === 'SUPPLY',
                    live,
                    label: live ? (zone.type === 'SUPPLY' ? 'Range high · short below it' : 'Range low · long above it') : null,
                });
            }
        });
        setBoxes(next);
    }, [timeframe]);

    const scheduleLayout = useCallback(() => {
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            layoutZones();
        });
    }, [layoutZones]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const chart = createChart(container, {
            width: container.clientWidth,
            height: container.clientHeight,
            layout: { background: { color: '#141414' }, textColor: '#d4d4d8' },
            grid: { vertLines: { color: '#232323' }, horzLines: { color: '#232323' } },
            rightPriceScale: { borderColor: '#2a2a2a', scaleMargins: { top: 0.1, bottom: 0.1 } },
            timeScale: { borderColor: '#2a2a2a', timeVisible: true, secondsVisible: false, rightOffset: 8 },
        });
        const series = chart.addSeries(CandlestickSeries, {
            upColor: LONG_GREEN,
            downColor: SHORT_RED,
            borderUpColor: LONG_GREEN,
            borderDownColor: SHORT_RED,
            wickUpColor: LONG_GREEN,
            wickDownColor: SHORT_RED,
        });
        chartRef.current = chart;
        seriesRef.current = series;
        markersRef.current = createSeriesMarkers(series, []);

        // Zones are HTML boxes laid over the canvas, so they follow every pan, zoom, and resize.
        chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleLayout);
        chart.subscribeCrosshairMove(scheduleLayout);
        const observer = new ResizeObserver(() => {
            chart.resize(container.clientWidth, container.clientHeight);
            scheduleLayout();
        });
        observer.observe(container);

        return () => {
            observer.disconnect();
            if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
            markersRef.current = null;
            priceLinesRef.current = [];
        };
    }, [scheduleLayout]);

    useEffect(() => {
        const chart = chartRef.current;
        const series = seriesRef.current;
        if (!chart || !series) return;

        series.setData(candles.map((candle) => ({
            time: toChartTime(candle.time),
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
        })));

        // Reframe only when the market changes, not on every live refresh.
        const market = `${timeframe}:${candles[0]?.time ?? 0}`;
        if (candles.length > 0 && market !== lastMarketRef.current) {
            lastMarketRef.current = market;
            chart.timeScale().setVisibleLogicalRange({
                from: Math.max(0, candles.length - INITIAL_VISIBLE_CANDLES),
                to: candles.length + 8,
            });
        }
        scheduleLayout();
    }, [candles, timeframe, scheduleLayout]);

    useEffect(() => {
        rangesRef.current = ranges;
        markersRef.current?.setMarkers(buildMarkers(trades, timeframe));
        scheduleLayout();
    }, [ranges, trades, timeframe, scheduleLayout]);

    useEffect(() => {
        const series = seriesRef.current;
        if (!series) return;

        for (const line of priceLinesRef.current) series.removePriceLine(line);
        priceLinesRef.current = openTrade
            ? [
                series.createPriceLine({ price: openTrade.entryPrice, color: '#fbbf24', lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: 'ENTRY' }),
                series.createPriceLine({ price: openTrade.stopLoss, color: SHORT_RED, lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'STOP' }),
                series.createPriceLine({ price: openTrade.takeProfit, color: LONG_GREEN, lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'TARGET' }),
            ]
            : [];
    }, [openTrade]);

    return (
        <div className="relative h-[520px] w-full overflow-hidden rounded-xl border border-[#2a2e39] bg-[#141414]">
            <div ref={containerRef} className="absolute inset-0" />
            <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden="true">
                {boxes.map((box) => (
                    <div
                        key={box.key}
                        className="absolute border-y"
                        style={{
                            left: box.left,
                            top: box.top,
                            width: box.width,
                            height: box.height,
                            borderColor: box.supply ? SHORT_RED : LONG_GREEN,
                            backgroundColor: box.supply ? 'rgba(255, 71, 87, 0.18)' : 'rgba(0, 210, 106, 0.18)',
                            opacity: box.live ? 1 : 0.4,
                        }}
                    >
                        {box.label && (
                            <span
                                className="absolute right-2 whitespace-nowrap text-[10px] font-bold"
                                style={{
                                    color: box.supply ? SHORT_RED : LONG_GREEN,
                                    // Outside the zone, on the side away from price, so it never covers candles in it.
                                    ...(box.supply ? { bottom: '100%' } : { top: '100%' }),
                                    textShadow: '0 0 3px #141414, 0 0 3px #141414',
                                }}
                            >
                                {box.label}
                            </span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
