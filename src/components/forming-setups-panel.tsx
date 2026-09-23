'use client';

import { useMemo, useState } from 'react';
import { CandleCloseCountdown } from '@/components/candle-close-countdown';
import { focusStrategyChart } from '@/lib/ui/focus-chart';
import {
    formatFormingSetupConsequence,
    formatFormingSetupPricePosition,
} from '@/lib/ui/forming-setup-copy';
import { formatPrice } from '@/lib/ui/format-price';
import { deriveFormingSetups } from '@/lib/ui/setup-forming';
import { useTradingStore } from '@/store/trading-store';

export function FormingSetupsPanel() {
    const prices = useTradingStore((state) => state.prices);
    const strategyStates = useTradingStore((state) => state.strategyStates);
    const showZones = useTradingStore((state) => state.showZones);
    const setSelectedCoin = useTradingStore((state) => state.setSelectedCoin);
    const setSelectedTimeframe = useTradingStore((state) => state.setSelectedTimeframe);
    const toggleZones = useTradingStore((state) => state.toggleZones);
    const [expanded, setExpanded] = useState(true);
    const setups = useMemo(
        () => deriveFormingSetups(strategyStates, prices),
        [prices, strategyStates]
    );

    const openMarket = (coin: string, timeframe: (typeof setups)[number]['timeframe']) => {
        setSelectedCoin(coin);
        setSelectedTimeframe(timeframe);
        if (!showZones) toggleZones();
        focusStrategyChart();
    };

    return (
        <section aria-labelledby="forming-setups-heading">
            <button
                type="button"
                aria-expanded={expanded}
                aria-controls="forming-setups-list"
                onClick={() => setExpanded((value) => !value)}
                className="mb-3 flex w-full items-center justify-between gap-3 text-left"
            >
                <span className="flex items-center gap-2">
                    <span id="forming-setups-heading" className="text-sm font-semibold text-[var(--text-muted)]">
                        Setups forming
                    </span>
                    <span className="badge badge-pending">{setups.length}</span>
                </span>
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={`text-[var(--text-muted)] transition-transform ${expanded ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                >
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </button>

            {expanded && (
                <div id="forming-setups-list" className="card space-y-1 p-2">
                    {setups.length === 0 ? (
                        <p className="px-2 py-3 text-center text-xs text-[var(--text-muted)]">
                            No active zones within 5% of live price.
                        </p>
                    ) : setups.map((setup) => {
                        const consequence = formatFormingSetupConsequence(setup.zone);
                        const pricePosition = formatFormingSetupPricePosition(
                            setup.distancePercent,
                            setup.priceRelation
                        );

                        return (
                            <button
                                type="button"
                                key={`${setup.marketKey}:${setup.zone.id}`}
                                onClick={() => openMarket(setup.coin, setup.timeframe)}
                                className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-white/5 ${
                                    setup.breakForming
                                        ? 'border-amber-400/50 bg-amber-400/10'
                                        : 'border-transparent'
                                }`}
                            >
                                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                    <span className="font-semibold text-[var(--foreground)]">
                                        {setup.coin} {setup.timeframe}
                                    </span>
                                    <span className={setup.zone.type === 'DEMAND'
                                        ? 'text-[var(--long-green)]'
                                        : 'text-[var(--short-red)]'}
                                    >
                                        {consequence}
                                    </span>
                                    <span className="text-[var(--text-muted)]">· {pricePosition}</span>
                                </span>

                                {setup.breakForming && (
                                    <span className="mt-2 block text-[11px] leading-relaxed text-amber-200">
                                        <span className="badge mr-2 border border-amber-400/50 bg-amber-400/15 text-amber-200">
                                            BREAK FORMING
                                        </span>
                                        confirms if the {setup.timeframe} candle closes beyond {formatPrice(setup.zone.distalLine)} —{' '}
                                        <CandleCloseCountdown timeframe={setup.timeframe} className="text-amber-200" />
                                    </span>
                                )}
                            </button>
                        );
                    })}

                    <p className="border-t border-[var(--card-border)] px-2 pt-2 text-[10px] leading-relaxed text-[var(--text-muted)]">
                        Provisional only. A setup becomes a signal only after a candle closes beyond the zone.
                    </p>
                </div>
            )}
        </section>
    );
}
