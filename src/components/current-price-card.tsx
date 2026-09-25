'use client';

import { Activity } from 'lucide-react';
import { formatPrice } from '@/lib/ui/format-price';
import { useTradingStore } from '@/store/trading-store';

interface CurrentPriceCardProps {
    className?: string;
}

export default function CurrentPriceCard({ className = '' }: CurrentPriceCardProps) {
    const selectedCoin = useTradingStore((state) => state.selectedCoin);
    const selectedTimeframe = useTradingStore((state) => state.selectedTimeframe);
    const currentPrice = useTradingStore((state) => state.prices[selectedCoin] ?? 0);

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

                <div>
                    <p className="text-sm font-semibold tracking-wide text-[var(--foreground)]">
                        {selectedCoin} / USD
                    </p>
                    <p className="mt-1 font-mono text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-none tracking-[-0.04em] tabular-nums text-[var(--foreground)]">
                    {currentPrice > 0
                        ? `$${formatPrice(currentPrice)}`
                        : '—'}
                    </p>
                </div>
            </div>
        </article>
    );
}
