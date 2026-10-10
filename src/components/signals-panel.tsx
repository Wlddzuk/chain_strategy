'use client';

import { useEffect, useMemo, useState } from 'react';
import { FormingSetupsPanel } from '@/components/forming-setups-panel';
import { SegmentedControl } from '@/components/segmented-control';
import SignalCard from '@/components/signal-card';
import { StrategyRecordCard } from '@/components/strategy-record-card';
import TradeTicket from '@/components/trade-ticket';
import TradingGlossary from '@/components/trading-glossary';
import {
    selectActiveSignalCount,
    selectActiveSignals,
} from '@/lib/ui/active-signals';
import { focusStrategyChart } from '@/lib/ui/focus-chart';
import { formatPrice } from '@/lib/ui/format-price';
import { formatRMultiple, getRToneClass } from '@/lib/ui/format-r';
import { deriveFormingSetups } from '@/lib/ui/setup-forming';
import {
    getHistoryCategory,
    getHistoryNetR,
    type HistoryFilter,
} from '@/lib/ui/signal-history';
import { getChartScopeEmptyState } from '@/lib/ui/signals-panel-copy';
import { sortActiveSignalsByActionability } from '@/lib/ui/trade-metrics';
import { getTradePlanKey } from '@/lib/trading/signal-identity';
import {
    formatRelativeAge,
    getSignalStatusBadgeClass,
    getSignalStatusLabel,
    isRecentSignal,
} from '@/lib/ui/signal-display';
import { type SidebarTab, useTradingStore } from '@/store/trading-store';

const HISTORY_LIMIT = 40;
const HISTORY_FILTERS: ReadonlyArray<{ value: HistoryFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'won', label: 'Won' },
    { value: 'lost', label: 'Lost' },
    { value: 'missed', label: 'Missed' },
    { value: 'other', label: 'Other' },
];

export default function SignalsPanel() {
    const selectedCoin = useTradingStore((state) => state.selectedCoin);
    const selectedTimeframe = useTradingStore((state) => state.selectedTimeframe);
    const selectedSignalId = useTradingStore((state) => state.selectedSignalId);
    const signals = useTradingStore((state) => state.signals);
    const outcomeHistory = useTradingStore((state) => state.outcomeHistory);
    const focusSignal = useTradingStore((state) => state.focusSignal);
    const approachThresholdPercent = useTradingStore((state) => state.settings.approachThresholdPercent);
    const showAllMarkets = useTradingStore((state) => state.showAllMarkets);
    const setShowAllMarkets = useTradingStore((state) => state.setShowAllMarkets);
    const sidebarTab = useTradingStore((state) => state.sidebarTab);
    const setSidebarTab = useTradingStore((state) => state.setSidebarTab);
    const prices = useTradingStore((state) => state.prices);
    const strategyStates = useTradingStore((state) => state.strategyStates);
    const makerFeePercent = useTradingStore((state) => state.settings.makerFeePercent);
    const takerFeePercent = useTradingStore((state) => state.settings.takerFeePercent);
    const [now, setNow] = useState(0);
    const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');

    useEffect(() => {
        const firstTick = window.setTimeout(() => setNow(Date.now()), 0);
        const interval = window.setInterval(() => setNow(Date.now()), 60000);
        return () => {
            window.clearTimeout(firstTick);
            window.clearInterval(interval);
        };
    }, []);

    const allActiveSignals = useMemo(
        () => selectActiveSignals(signals),
        [signals]
    );
    const allActiveCount = selectActiveSignalCount(signals);
    const chartScopeEmptyState = getChartScopeEmptyState(
        selectedCoin,
        selectedTimeframe,
        allActiveCount
    );
    const visibleSignals = allActiveSignals.filter((signal) => (
        showAllMarkets ||
        (signal.coin === selectedCoin && signal.timeframe === selectedTimeframe)
    ));
    const activeSignals = sortActiveSignalsByActionability(
        visibleSignals,
        useTradingStore.getState().prices,
        approachThresholdPercent
    );
    const selectedSignal = useMemo(
        () => signals.find((signal) => signal.id === selectedSignalId) ?? null,
        [selectedSignalId, signals]
    );
    const recentActivity = useMemo(() => {
        const uniquePlans = new Map<string, (typeof signals)[number]>();
        const sorted = signals
            .filter(isRecentSignal)
            .sort((first, second) => (second.closedAt ?? second.createdAt) - (first.closedAt ?? first.createdAt));

        for (const signal of sorted) {
            const key = `${getTradePlanKey(signal)}:${signal.status}:${signal.outcome ?? 'none'}`;
            if (!uniquePlans.has(key)) uniquePlans.set(key, signal);
        }
        return Array.from(uniquePlans.values()).slice(0, HISTORY_LIMIT);
    }, [signals]);
    const filteredActivity = historyFilter === 'all'
        ? recentActivity
        : recentActivity.filter((signal) => getHistoryCategory(signal) === historyFilter);

    const formingSetups = useMemo(
        () => deriveFormingSetups(strategyStates, prices),
        [prices, strategyStates]
    );
    const tabs: ReadonlyArray<{ value: SidebarTab; label: string; count?: number }> = [
        { value: 'signals', label: 'Signals', count: activeSignals.length },
        { value: 'forming', label: 'Forming', count: formingSetups.length },
        { value: 'record', label: 'Record' },
        { value: 'history', label: 'History', count: recentActivity.length },
    ];

    const handleFocus = (signalId: string) => {
        focusSignal(signalId);
        focusStrategyChart();
    };

    return (
        <aside
            className="relative z-10 flex flex-col gap-4 lg:sticky lg:top-14 lg:max-h-[calc(100dvh-4.5rem)] lg:self-start"
            aria-label="Trade signals"
        >
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Trade Signals</h2>
                <div className="flex items-center gap-2">
                    <TradingGlossary />
                    <button
                        type="button"
                        aria-pressed={showAllMarkets}
                        onClick={() => setShowAllMarkets(!showAllMarkets)}
                        className={`btn text-xs ${showAllMarkets ? 'btn-primary' : 'btn-outline'}`}
                    >
                        {showAllMarkets ? 'All markets' : 'This chart'}
                    </button>
                </div>
            </div>

            <SegmentedControl
                label="Signals sidebar"
                idPrefix="sidebar"
                options={tabs}
                value={sidebarTab}
                onChange={setSidebarTab}
            />

            <div
                id="sidebar-panel"
                role="tabpanel"
                aria-labelledby={`sidebar-tab-${sidebarTab}`}
                className="scroll-quiet -mr-2 space-y-3 pr-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain"
            >
                {sidebarTab === 'signals' && (
                    <>
                        {selectedSignal && (
                            <TradeTicket key={selectedSignal.id} signal={selectedSignal} now={now} />
                        )}

                        {activeSignals.length === 0 ? (
                            <div className="card">
                                <div className="text-center py-8">
                                    <svg className="w-12 h-12 mx-auto mb-4 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                                        <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                    </svg>
                                    {showAllMarkets ? (
                                        <>
                                            <p className="text-[var(--text-muted)]">No active signals</p>
                                            <p className="mt-2 text-sm text-[var(--text-muted)]">
                                                The background scanner is watching the full list.
                                            </p>
                                        </>
                                    ) : (
                                        <p className="text-sm text-[var(--text-muted)]">
                                            {chartScopeEmptyState.message}
                                            {chartScopeEmptyState.canViewAll && (
                                                <>
                                                    {' '}·{' '}
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowAllMarkets(true)}
                                                        className="font-semibold text-[var(--accent)] underline underline-offset-2"
                                                    >
                                                        View all
                                                    </button>
                                                </>
                                            )}
                                        </p>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {activeSignals.map((signal) => (
                                    <SignalCard key={signal.id} signal={signal} now={now} />
                                ))}
                            </div>
                        )}
                    </>
                )}

                {sidebarTab === 'forming' && <FormingSetupsPanel setups={formingSetups} />}

                {sidebarTab === 'record' && <StrategyRecordCard history={outcomeHistory} />}

                {sidebarTab === 'history' && (
                    <section aria-label="Recent activity">
                        <div className="card">
                            <div className="mb-3 flex flex-wrap gap-1" aria-label="Filter history">
                                {HISTORY_FILTERS.map((option) => {
                                    const count = option.value === 'all'
                                        ? recentActivity.length
                                        : recentActivity.filter((signal) => getHistoryCategory(signal) === option.value).length;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            aria-pressed={historyFilter === option.value}
                                            onClick={() => setHistoryFilter(option.value)}
                                            className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                                                historyFilter === option.value
                                                    ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                                                    : 'border-[var(--card-border)] text-[var(--text-muted)] hover:text-white'
                                            }`}
                                        >
                                            {option.label} <span className="font-mono tabular-nums">{count}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            {filteredActivity.length === 0 ? (
                                <p className="text-sm text-[var(--text-muted)] text-center py-4">
                                    {recentActivity.length === 0
                                        ? 'No missed, closed, dismissed, or invalidated plans yet'
                                        : 'No plans match this filter'}
                                </p>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-[11px] text-[var(--text-muted)]">
                                            <th scope="col" className="pb-1.5 font-medium">Plan</th>
                                            <th scope="col" className="pb-1.5 text-right font-medium">Result</th>
                                            <th scope="col" className="pb-1.5 pl-3 text-right font-medium">R after fees</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredActivity.map((signal) => {
                                            const netR = getHistoryNetR(signal, { makerFeePercent, takerFeePercent });
                                            return (
                                                <tr
                                                    key={`${signal.id}-${signal.status}-${signal.outcome ?? 'open'}`}
                                                    className="border-t border-[var(--card-border)]"
                                                >
                                                    <td className="py-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleFocus(signal.id)}
                                                            className="text-left hover:underline"
                                                        >
                                                            <span className={signal.direction === 'LONG' ? 'text-[var(--long-green)]' : 'text-[var(--short-red)]'}>
                                                                {signal.direction}
                                                            </span>{' '}
                                                            {signal.coin}{' '}
                                                            <span className="text-[var(--text-muted)]">{signal.timeframe}</span>
                                                            <span className="block text-[11px] text-[var(--text-muted)]">
                                                                @ ${formatPrice(signal.entryPrice)} · {formatRelativeAge(signal.closedAt ?? signal.createdAt, now)}
                                                                {signal.status === 'MISSED' && signal.closestEntryApproachPercent !== undefined && (
                                                                    <> · missed entry by {signal.closestEntryApproachPercent.toFixed(2)}%</>
                                                                )}
                                                            </span>
                                                        </button>
                                                    </td>
                                                    <td className="py-2 text-right">
                                                        <span className={`badge ${getSignalStatusBadgeClass(signal)}`}>
                                                            {getSignalStatusLabel(signal, now)}
                                                        </span>
                                                    </td>
                                                    <td className={`py-2 pl-3 text-right font-mono font-semibold tabular-nums ${netR === null ? 'text-[var(--text-muted)]' : getRToneClass(netR)}`}>
                                                        {netR === null ? '—' : `${formatRMultiple(netR)}R`}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                            <p className="mt-4 border-t border-[var(--card-border)] pt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
                                Outcomes are based on market price touches, not your actual fills or exchange account.
                            </p>
                        </div>
                    </section>
                )}
            </div>
        </aside>
    );
}
