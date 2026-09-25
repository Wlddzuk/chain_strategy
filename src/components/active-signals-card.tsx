'use client';

import { useMemo } from 'react';
import { ChevronRight, Radar } from 'lucide-react';
import { selectActiveSignalCount } from '@/lib/ui/active-signals';
import { calculateStrategyRecord } from '@/lib/ui/strategy-record';
import { useTradingStore } from '@/store/trading-store';

interface ActiveSignalsCardProps {
    className?: string;
}

export default function ActiveSignalsCard({ className = '' }: ActiveSignalsCardProps) {
    const activeCount = useTradingStore(
        (state) => selectActiveSignalCount(state.signals)
    );
    const watchedMarketCount = useTradingStore((state) => state.availableCoins.length);
    const outcomeHistory = useTradingStore((state) => state.outcomeHistory);
    const setSidebarTab = useTradingStore((state) => state.setSidebarTab);
    // 'all' ignores the clock, so the summary is stable between renders.
    const record = useMemo(
        () => calculateStrategyRecord(outcomeHistory, 'all', 0),
        [outcomeHistory]
    );
    const netR = record.netR > 0
        ? `+${record.netR.toFixed(1)}R`
        : record.netR < 0
            ? `−${Math.abs(record.netR).toFixed(1)}R`
            : '0.0R';

    const openRecord = () => {
        setSidebarTab('record');
        document.querySelector('[aria-label="Trade signals"]')?.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
        });
    };

    return (
        <article
            aria-label="Active signals across all markets"
            className={`card relative flex min-h-36 overflow-hidden ${className}`}
        >
            <div
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-20 -right-10 h-40 w-40 rounded-full bg-[var(--long-green-dim)] blur-3xl"
            />

            <div className="relative flex w-full flex-col justify-between gap-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="stat-label">Active signals</p>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                            All markets
                        </p>
                    </div>

                    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--background)]/65 p-2 text-[var(--accent)]">
                        <Radar aria-hidden="true" className="h-4 w-4" />
                    </div>
                </div>

                <div className="flex items-end justify-between gap-3">
                    <p
                        aria-live="polite"
                        className="font-mono text-4xl font-semibold leading-none tracking-[-0.04em] tabular-nums text-[var(--foreground)]"
                    >
                        {activeCount}
                    </p>
                    <p className="pb-0.5 text-right text-[11px] leading-4 text-[var(--text-muted)]">
                        Watching {watchedMarketCount}
                        <br />
                        {watchedMarketCount === 1 ? 'market' : 'markets'}
                    </p>
                </div>

                <button
                    type="button"
                    onClick={openRecord}
                    className="press -mx-2 -mb-2 flex items-center justify-between gap-2 rounded-lg border-t border-[var(--hairline)] px-2 pb-2 pt-2.5 text-left text-[11px] text-[var(--text-muted)] transition-colors hover:bg-white/[0.04] hover:text-[var(--foreground)]"
                    aria-label={`Strategy record: ${record.resolved} resolved trades, ${record.wins} wins, ${record.losses} losses, ${netR}. Open the Record tab.`}
                >
                    <span className="min-w-0 truncate">
                        <span className="font-semibold text-[var(--foreground)]">{record.resolved}</span> trades
                        {' · '}
                        <span className="text-[var(--long-green)]">{record.wins}W</span>
                        {' '}
                        <span className="text-[var(--short-red)]">{record.losses}L</span>
                        {' · '}
                        <span className={record.netR > 0 ? 'text-[var(--long-green)]' : record.netR < 0 ? 'text-[var(--short-red)]' : ''}>
                            {netR}
                        </span>
                    </span>
                    <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                </button>
            </div>
        </article>
    );
}
