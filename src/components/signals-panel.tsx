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
import { deriveFormingSetups } from '@/lib/ui/setup-forming';
import { getChartScopeEmptyState } from '@/lib/ui/signals-panel-copy';
import { sortActiveSignalsByActionability } from '@/lib/ui/trade-metrics';
import { getTradePlanKey } from '@/lib/trading/signal-identity';
import {
    getSignalStatusBadgeClass,
    getSignalStatusLabel,
    isRecentSignal,
} from '@/lib/ui/signal-display';
import { type SidebarTab, useTradingStore } from '@/store/trading-store';

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
    const [now, setNow] = useState(0);

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
        return Array.from(uniquePlans.values()).slice(0, 8);
    }, [signals]);

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
                <div>
                    <h2 className="text-lg font-semibold">Trade Signals</h2>
                    <p className="text-xs text-[var(--text-muted)]">Planning only — no exchange orders</p>
                </div>
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
                            {recentActivity.length === 0 ? (
                                <p className="text-sm text-[var(--text-muted)] text-center py-4">
                                    No missed, closed, dismissed, or invalidated plans yet
                                </p>
                            ) : (
                                <div className="space-y-3">
                                    {recentActivity.map((signal) => (
                                        <button
                                            type="button"
                                            key={`${signal.id}-${signal.status}-${signal.outcome ?? 'open'}`}
                                            onClick={() => handleFocus(signal.id)}
                                            className="w-full flex items-center justify-between gap-3 text-sm text-left"
                                        >
                                            <span className="min-w-0">
                                                <span>{signal.coin} {signal.direction}</span>{' '}
                                                <span className="text-[var(--text-muted)]">
                                                    {signal.timeframe} @ ${formatPrice(signal.entryPrice)}
                                                </span>
                                                {signal.status === 'TOUCHED' && (
                                                    <span className={signal.outcome === 'LOSS' ? 'text-[var(--short-red)]' : signal.outcome === 'WIN' ? 'text-[var(--long-green)]' : 'text-[var(--text-muted)]'}>
                                                        {' '}ENTRY HIT → {signal.outcome === 'WIN'
                                                            ? `would have WON +${signal.riskRewardRatio.toFixed(1)}R`
                                                            : signal.outcome === 'LOSS'
                                                                ? 'would have LOST −1.0R'
                                                                : 'stale after 48h'}
                                                    </span>
                                                )}
                                                {signal.status !== 'TOUCHED' && signal.outcome && (
                                                    <span className={signal.outcome === 'WIN' ? 'text-[var(--long-green)]' : 'text-[var(--short-red)]'}>
                                                        {' '}{signal.outcome === 'WIN' ? `+${signal.riskRewardRatio.toFixed(1)}R` : '−1.0R'}
                                                    </span>
                                                )}
                                            </span>
                                            <span className={`badge shrink-0 ${getSignalStatusBadgeClass(signal)}`}>
                                                {getSignalStatusLabel(signal, now)}
                                            </span>
                                        </button>
                                    ))}
                                </div>
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
