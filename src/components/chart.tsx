'use client';

import { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time, CandlestickSeries } from 'lightweight-charts';
import { Candle, Zone } from '@/lib/trading/types';

interface ChartProps {
    candles: Candle[];
    zones?: Zone[];
    isLoading?: boolean;
}

export default function Chart({ candles, zones = [], isLoading }: ChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const priceLinesRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([]);

    // Initialize chart
    useEffect(() => {
        if (!containerRef.current) return;

        const chart = createChart(containerRef.current, {
            layout: {
                background: { color: '#141414' },
                textColor: '#ededed',
            },
            grid: {
                vertLines: { color: '#262626' },
                horzLines: { color: '#262626' },
            },
            crosshair: {
                mode: 1,
                vertLine: {
                    color: '#6366f1',
                    width: 1,
                    style: 2,
                    labelBackgroundColor: '#6366f1',
                },
                horzLine: {
                    color: '#6366f1',
                    width: 1,
                    style: 2,
                    labelBackgroundColor: '#6366f1',
                },
            },
            rightPriceScale: {
                borderColor: '#262626',
                scaleMargins: {
                    top: 0.1,
                    bottom: 0.1,
                },
            },
            timeScale: {
                borderColor: '#262626',
                timeVisible: true,
                secondsVisible: false,
            },
            handleScale: {
                axisPressedMouseMove: true,
            },
            handleScroll: {
                mouseWheel: true,
                pressedMouseMove: true,
            },
        });

        const series = chart.addSeries(CandlestickSeries, {
            upColor: '#00d26a',
            downColor: '#ff4757',
            borderUpColor: '#00d26a',
            borderDownColor: '#ff4757',
            wickUpColor: '#00d26a',
            wickDownColor: '#ff4757',
        });

        chartRef.current = chart;
        seriesRef.current = series;

        // Handle resize
        const handleResize = () => {
            if (containerRef.current && chartRef.current) {
                chartRef.current.applyOptions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight,
                });
            }
        };

        window.addEventListener('resize', handleResize);
        handleResize();

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, []);

    // Update candle data
    useEffect(() => {
        if (!seriesRef.current || candles.length === 0) return;

        const chartData: CandlestickData<Time>[] = candles.map((c) => ({
            time: (c.time / 1000) as Time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
        }));

        seriesRef.current.setData(chartData);

        if (chartRef.current) {
            chartRef.current.timeScale().fitContent();
        }
    }, [candles]);

    // Draw zone overlays using price lines
    useEffect(() => {
        if (!seriesRef.current) return;

        // Clear existing price lines
        priceLinesRef.current.forEach(line => {
            try {
                seriesRef.current?.removePriceLine(line);
            } catch (e) {
                // Line may already be removed
            }
        });
        priceLinesRef.current = [];

        if (zones.length === 0) return;

        // Create price lines for each zone
        zones.forEach((zone) => {
            if (zone.status === 'BROKEN' || !seriesRef.current) return;

            const isSupply = zone.type === 'SUPPLY';
            const isEvent = zone.status === 'EVENT';

            // Zone colors
            const lineColor = isEvent
                ? '#666666'
                : isSupply
                    ? '#ff4757'
                    : '#00d26a';

            // Proximal line (entry level) - solid
            try {
                const proximalLine = seriesRef.current.createPriceLine({
                    price: zone.proximalLine,
                    color: lineColor,
                    lineWidth: 2,
                    lineStyle: 0, // Solid
                    axisLabelVisible: true,
                    title: isEvent ? 'EVT' : isSupply ? 'S' : 'D',
                });
                priceLinesRef.current.push(proximalLine);

                // Distal line (stop level) - dashed
                const distalLine = seriesRef.current.createPriceLine({
                    price: zone.distalLine,
                    color: lineColor,
                    lineWidth: 1,
                    lineStyle: 2, // Dashed
                    axisLabelVisible: false,
                    title: '',
                });
                priceLinesRef.current.push(distalLine);
            } catch (e) {
                console.error('Error creating price line:', e);
            }
        });

    }, [zones]);

    if (isLoading) {
        return (
            <div className="chart-container flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <svg className="animate-spin w-8 h-8 text-[var(--accent)]" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-[var(--text-muted)]">Loading chart data...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="relative">
            <div className="chart-container" ref={containerRef} style={{ height: 500 }} />

            {/* Zone Legend */}
            {zones.length > 0 && (
                <div className="absolute top-4 left-4 flex gap-4 text-xs">
                    <div className="flex items-center gap-2 bg-[var(--card-bg)] px-3 py-1.5 rounded-lg border border-[var(--card-border)]">
                        <div className="w-3 h-3 rounded-sm bg-[#00d26a]" />
                        <span>Demand (D)</span>
                    </div>
                    <div className="flex items-center gap-2 bg-[var(--card-bg)] px-3 py-1.5 rounded-lg border border-[var(--card-border)]">
                        <div className="w-3 h-3 rounded-sm bg-[#ff4757]" />
                        <span>Supply (S)</span>
                    </div>
                    <div className="flex items-center gap-2 bg-[var(--card-bg)] px-3 py-1.5 rounded-lg border border-[var(--card-border)]">
                        <div className="w-3 h-3 rounded-sm bg-[#666666]" />
                        <span>Event (EVT)</span>
                    </div>
                </div>
            )}

            {/* Zone count badge */}
            <div className="absolute top-4 right-4 bg-[var(--card-bg)] px-3 py-1.5 rounded-lg border border-[var(--card-border)] text-xs">
                <span className="text-[var(--text-muted)]">Zones: </span>
                <span className="font-semibold">{zones.filter(z => z.status !== 'BROKEN').length}</span>
            </div>
        </div>
    );
}
