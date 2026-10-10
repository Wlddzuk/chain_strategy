'use client';

import { useMemo } from 'react';
import { Activity } from 'lucide-react';
import { formatPrice } from '@/lib/ui/format-price';
import { buildSparklinePath } from '@/lib/ui/sparkline';
import { useTradingStore } from '@/store/trading-store';

const SPARKLINE_CANDLES = 48;
const SPARKLINE_WIDTH = 300;
const SPARKLINE_HEIGHT = 80;

interface CurrentPriceCardProps {
    className?: string;
}

export default function CurrentPriceCard({ className = '' }: CurrentPriceCardProps) {
    const selectedCoin = useTradingStore((state) => state.selectedCoin);
    const selectedTimeframe = useTradingStore((state) => state.selectedTimeframe);
    const currentPrice = useTradingStore((state) => state.prices[selectedCoin] ?? 0);
    const candles = useTradingStore(
        (state) => state.candleData[selectedCoin]?.[selectedTimeframe]?.candles
    );
    const trend = useMemo(() => {
        const closes = (candles ?? []).slice(-SPARKLINE_CANDLES).map((candle) => candle.close);
        const path = buildSparklinePath(closes, SPARKLINE_WIDTH, SPARKLINE_HEIGHT);
        if (path === null) return null;
        const first = closes[0];
        const last = closes[closes.length - 1];
        return {
            path,
            count: closes.length,
            changePercent: first > 0 ? ((last - first) / first) * 100 : 0,
        };
    }, [candles]);
    const trendColor = trend && trend.changePercent < 0 ? 'var(--short-red)' : 'var(--long-green)';

    return (
        <article
            aria-label={`${selectedCoin} current price`}
            className={`card relative flex min-h-36 overflow-hidden ${className}`}
        >
            <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-[var(--accent-dim)] blur-3xl"
            />

            <div className="relative flex w-full flex-col justify-between gap-5">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="stat-label">Current price</p>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                            Selected market
                        </p>
                    </div>

                    <div className="flex items-center gap-1.5 rounded-full border border-[var(--card-border)] bg-[var(--background)]/65 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                        <Activity aria-hidden="true" className="h-3 w-3 text-[var(--long-green)]" />
                        {selectedTimeframe}
                    </div>
                </div>

                {trend && (
                    <svg
                        viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
                        preserveAspectRatio="none"
                        className="min-h-10 w-full flex-1 overflow-visible"
                        role="img"
                        aria-label={`${selectedCoin} moved ${trend.changePercent.toFixed(2)}% over the last ${trend.count} ${selectedTimeframe} candles`}
                    >
                        <path
                            d={trend.path}
                            fill="none"
                            stroke={trendColor}
                            strokeWidth={1.5}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                        />
                    </svg>
                )}

                <div className="flex items-end justify-between gap-4">
                    <div className="min-w-0">
                        <p className="text-sm font-semibold tracking-wide text-[var(--foreground)]">
                            {selectedCoin} / USD
                        </p>
                        <p className="mt-1 font-mono text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-none tracking-[-0.04em] tabular-nums text-[var(--foreground)]">
                            {currentPrice > 0
                                ? `$${formatPrice(currentPrice)}`
                                : '—'}
                        </p>
                    </div>

                    {trend && (
                        <p className="shrink-0 text-right text-[10px] leading-4 text-[var(--text-muted)]">
                            <span className="block font-mono text-xs font-semibold tabular-nums" style={{ color: trendColor }}>
                                {trend.changePercent >= 0 ? '+' : '−'}{Math.abs(trend.changePercent).toFixed(2)}%
                            </span>
                            last {trend.count} × {selectedTimeframe}
                        </p>
                    )}
                </div>
            </div>
        </article>
    );
}
