'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    calculateStrategyRecord,
    LOW_SAMPLE_WARNING,
    type OutcomeHistoryItem,
    type StrategyRecordWindow,
} from '@/lib/ui/strategy-record';

const RECORD_WINDOWS: ReadonlyArray<{
    value: StrategyRecordWindow;
    label: string;
}> = [
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
    { value: 'all', label: 'All' },
];

interface StrategyRecordCardProps {
    history: readonly OutcomeHistoryItem[];
    now?: number;
}

function formatRMultiple(value: number): string {
    if (value > 0) return `+${value.toFixed(1)}`;
    if (value < 0) return `−${Math.abs(value).toFixed(1)}`;
    return '0.0';
}

export function StrategyRecordCard({ history, now }: StrategyRecordCardProps) {
    const [recordWindow, setRecordWindow] = useState<StrategyRecordWindow>('30d');
    const [clientNow, setClientNow] = useState(0);

    useEffect(() => {
        if (now !== undefined) return;

        const firstTick = window.setTimeout(() => setClientNow(Date.now()), 0);
        const interval = window.setInterval(() => setClientNow(Date.now()), 60 * 60 * 1000);
        return () => {
            window.clearTimeout(firstTick);
            window.clearInterval(interval);
        };
    }, [now]);

    const referenceNow = now ?? clientNow;
    const clockReady = now !== undefined || clientNow > 0;
    const record = useMemo(
        () => clockReady
            ? calculateStrategyRecord(history, recordWindow, referenceNow)
            : null,
        [clockReady, history, recordWindow, referenceNow]
    );

    return (
        <section className="card" aria-labelledby="strategy-record-title">
            <div className="flex items-center justify-between gap-3">
                <h3 id="strategy-record-title" className="text-sm font-semibold">
                    Strategy record
                </h3>
                <div className="flex rounded-lg border border-[var(--card-border)] p-0.5" aria-label="Strategy record window">
                    {RECORD_WINDOWS.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            aria-pressed={recordWindow === option.value}
                            onClick={() => setRecordWindow(option.value)}
                            className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                                recordWindow === option.value
                                    ? 'bg-[var(--accent)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-white'
                            }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>

            {record ? (
                <>
                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                <div>
                    <dt className="text-[var(--text-muted)]">Resolved plans</dt>
                    <dd className="mt-0.5 font-mono text-base font-semibold">{record.resolved}</dd>
                </div>
                <div>
                    <dt className="text-[var(--text-muted)]">Would-have wins</dt>
                    <dd className="mt-0.5 font-mono text-base font-semibold text-[var(--long-green)]">
                        {record.wins}
                        {record.showWinRate && record.winRate !== null && (
                            <span className="ml-1 text-xs">({record.winRate.toFixed(0)}%)</span>
                        )}
                    </dd>
                </div>
                <div>
                    <dt className="text-[var(--text-muted)]">Losses</dt>
                    <dd className="mt-0.5 font-mono text-base font-semibold text-[var(--short-red)]">{record.losses}</dd>
                </div>
                <div>
                    <dt className="text-[var(--text-muted)]">Total R (gross)</dt>
                    <dd className={`mt-0.5 font-mono text-base font-semibold ${
                        record.netR > 0
                            ? 'text-[var(--long-green)]'
                            : record.netR < 0
                                ? 'text-[var(--short-red)]'
                                : ''
                    }`}>
                        {formatRMultiple(record.netR)}
                    </dd>
                </div>
                <div>
                    <dt className="text-[var(--text-muted)]">Missed</dt>
                    <dd className="mt-0.5 font-mono text-base font-semibold text-amber-200">{record.missed}</dd>
                </div>
                    </dl>

                    {record.isLowSample && (
                        <p className="mt-4 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-semibold leading-relaxed text-amber-100">
                            {LOW_SAMPLE_WARNING}
                        </p>
                    )}
                </>
            ) : (
                <p className="mt-4 text-xs text-[var(--text-muted)]">Loading saved record…</p>
            )}

            <p className="mt-4 border-t border-[var(--card-border)] pt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
                Outcomes are based on market price touches, not your actual fills or exchange account.
                {' '}R assumes the full position exits at the final target or stop; fees, funding, slippage, and partial exits are excluded.
            </p>
        </section>
    );
}
