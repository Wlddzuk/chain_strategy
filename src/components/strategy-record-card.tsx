'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTradingStore } from '@/store/trading-store';
import { formatRMultiple, getRToneClass } from '@/lib/ui/format-r';
import {
    calculateMissedPlanStats,
    calculateStrategyBreakdown,
    calculateStrategyRecord,
    LOW_SAMPLE_WARNING,
    NEAR_MISS_MAX_R,
    type OutcomeHistoryItem,
    type StrategyBreakdownDimension,
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

const BREAKDOWN_DIMENSIONS: ReadonlyArray<{
    value: StrategyBreakdownDimension;
    label: string;
}> = [
    { value: 'timeframe', label: 'Timeframe' },
    { value: 'coin', label: 'Coin' },
    { value: 'direction', label: 'Direction' },
];

interface StrategyRecordCardProps {
    history: readonly OutcomeHistoryItem[];
    now?: number;
    title?: string;
    defaultWindow?: StrategyRecordWindow;
}

export function StrategyRecordCard({
    history,
    now,
    title = 'Strategy record',
    defaultWindow = '30d',
}: StrategyRecordCardProps) {
    const [recordWindow, setRecordWindow] = useState<StrategyRecordWindow>(defaultWindow);
    const [breakdownDimension, setBreakdownDimension] = useState<StrategyBreakdownDimension>('timeframe');
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

    const makerFeePercent = useTradingStore((state) => state.settings.makerFeePercent);
    const takerFeePercent = useTradingStore((state) => state.settings.takerFeePercent);

    const referenceNow = now ?? clientNow;
    const clockReady = now !== undefined || clientNow > 0;
    const record = useMemo(
        () => clockReady
            ? calculateStrategyRecord(history, recordWindow, referenceNow, { makerFeePercent, takerFeePercent })
            : null,
        [clockReady, history, recordWindow, referenceNow, makerFeePercent, takerFeePercent]
    );
    const missedStats = useMemo(
        () => clockReady ? calculateMissedPlanStats(history, recordWindow, referenceNow) : null,
        [clockReady, history, recordWindow, referenceNow]
    );
    const breakdown = useMemo(
        () => clockReady
            ? calculateStrategyBreakdown(
                history,
                breakdownDimension,
                recordWindow,
                referenceNow,
                { makerFeePercent, takerFeePercent }
            )
            : [],
        [clockReady, history, breakdownDimension, recordWindow, referenceNow, makerFeePercent, takerFeePercent]
    );

    return (
        <section className="card" aria-labelledby="strategy-record-title">
            <div className="flex items-center justify-between gap-3">
                <h3 id="strategy-record-title" className="text-sm font-semibold">
                    {title}
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
                    <dt className="text-[var(--text-muted)]">Total R after fees</dt>
                    <dd className={`mt-0.5 font-mono text-base font-semibold ${getRToneClass(record.netR ?? 0)}`}>
                        {record.netR === null ? '—' : formatRMultiple(record.netR)}
                    </dd>
                </div>
                <div>
                    <dt className="text-[var(--text-muted)]">Total R before fees</dt>
                    <dd className={`mt-0.5 font-mono text-base font-semibold ${getRToneClass(record.grossR)}`}>
                        {formatRMultiple(record.grossR)}
                    </dd>
                </div>
                <div>
                    <dt className="text-[var(--text-muted)]">Missed</dt>
                    <dd className="mt-0.5 font-mono text-base font-semibold text-amber-200">{record.missed}</dd>
                </div>
                    </dl>

                    <div className="mt-4 border-t border-[var(--card-border)] pt-3">
                        <div className="flex items-center justify-between gap-3">
                            <h4 className="text-xs font-semibold">Split by</h4>
                            <div className="flex rounded-lg border border-[var(--card-border)] p-0.5" aria-label="Split record by">
                                {BREAKDOWN_DIMENSIONS.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        aria-pressed={breakdownDimension === option.value}
                                        onClick={() => setBreakdownDimension(option.value)}
                                        className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                                            breakdownDimension === option.value
                                                ? 'bg-[var(--accent)] text-white'
                                                : 'text-[var(--text-muted)] hover:text-white'
                                        }`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {breakdown.length > 0 ? (
                            <table className="mt-3 w-full text-xs">
                                <thead>
                                    <tr className="text-left text-[11px] text-[var(--text-muted)]">
                                        <th scope="col" className="pb-1.5 font-medium">
                                            {BREAKDOWN_DIMENSIONS.find((option) => option.value === breakdownDimension)?.label}
                                        </th>
                                        <th scope="col" className="pb-1.5 text-right font-medium">W / L</th>
                                        <th scope="col" className="pb-1.5 text-right font-medium">Win %</th>
                                        <th scope="col" className="pb-1.5 text-right font-medium">Missed</th>
                                        <th scope="col" className="pb-1.5 text-right font-medium">R after fees</th>
                                    </tr>
                                </thead>
                                <tbody className="font-mono">
                                    {breakdown.map(({ key, record: row }) => {
                                        const rowR = row.netR ?? row.grossR;
                                        return (
                                            <tr key={key} className="border-t border-[var(--card-border)]">
                                                <th scope="row" className="py-1.5 text-left font-sans font-medium">
                                                    {breakdownDimension === 'direction'
                                                        ? key === 'LONG' ? 'Long' : 'Short'
                                                        : key}
                                                </th>
                                                <td className="py-1.5 text-right">
                                                    <span className="text-[var(--long-green)]">{row.wins}</span>
                                                    {' / '}
                                                    <span className="text-[var(--short-red)]">{row.losses}</span>
                                                </td>
                                                <td className="py-1.5 text-right">
                                                    {row.winRate === null ? '—' : `${row.winRate.toFixed(0)}%`}
                                                </td>
                                                <td className="py-1.5 text-right text-amber-200">{row.missed}</td>
                                                <td className={`py-1.5 text-right font-semibold ${getRToneClass(rowR)}`}>
                                                    {row.resolved === 0 ? '—' : formatRMultiple(rowR)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        ) : (
                            <p className="mt-3 text-xs text-[var(--text-muted)]">No closed plans in this window yet.</p>
                        )}
                    </div>

                    {missedStats !== null && missedStats.missed > 0 && (
                        <div className="mt-4 border-t border-[var(--card-border)] pt-3 text-xs">
                            <h4 className="font-semibold">Missed plans</h4>
                            <p className="mt-1 leading-relaxed text-[var(--text-muted)]">
                                {missedStats.missed} {missedStats.missed === 1 ? 'plan' : 'plans'} ran to target without reaching entry,
                                against {record.resolved} that filled.
                            </p>
                            {missedStats.tracked > 0 && missedStats.medianMissedByR !== null ? (
                                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                                    <div>
                                        <dt className="text-[var(--text-muted)]">Near misses (within {NEAR_MISS_MAX_R}R)</dt>
                                        <dd className="mt-0.5 font-mono text-base font-semibold text-amber-200">
                                            {missedStats.nearMisses}
                                            <span className="ml-1 text-xs">of {missedStats.tracked}</span>
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-[var(--text-muted)]">Typical gap to entry</dt>
                                        <dd className="mt-0.5 font-mono text-base font-semibold">
                                            {missedStats.medianMissedByR.toFixed(2)}R
                                        </dd>
                                    </div>
                                </dl>
                            ) : (
                                <p className="mt-2 leading-relaxed text-[var(--text-muted)]">
                                    How close price came to entry is saved for plans missed from now on.
                                </p>
                            )}
                            {missedStats.tracked > 0 && (
                                <p className="mt-3 leading-relaxed text-[var(--text-muted)]">
                                    The gap is the nearest price came to entry, measured against the stop distance.
                                    Many near misses mean the entry sits too deep in the zone.
                                    {missedStats.tracked < missedStats.missed && (
                                        <> {missedStats.missed - missedStats.tracked} older missed {missedStats.missed - missedStats.tracked === 1 ? 'plan was' : 'plans were'} not measured.</>
                                    )}
                                </p>
                            )}
                        </div>
                    )}

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
                {' '}R assumes the full position exits at the final target or stop.
                {' '}After-fees R charges the maker fee on the limit entry and limit target and the taker fee on the stop;
                funding, slippage, and partial exits are excluded.
                {record !== null && record.feeEstimatedCount > 0 && (
                    <> Fees for {record.feeEstimatedCount} older {record.feeEstimatedCount === 1 ? 'trade' : 'trades'} use the median stop size, because their own was not saved.</>
                )}
            </p>
        </section>
    );
}
