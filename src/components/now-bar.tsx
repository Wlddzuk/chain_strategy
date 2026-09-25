'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatPrice } from '@/lib/ui/format-price';
import { focusStrategyChart } from '@/lib/ui/focus-chart';
import { formatFormingSetupPricePosition } from '@/lib/ui/forming-setup-copy';
import {
    isSameNowBarItem,
    revealNowBarItem,
    selectNowBarItem,
    stabilizeNowBarItem,
    type StableNowBarSelection,
} from '@/lib/ui/now-bar';
import {
    deriveBreakFormingSetups,
    deriveFormingSetups,
    getZoneProximity,
} from '@/lib/ui/setup-forming';
import {
    formatCandleCountdown,
    getMillisecondsUntilCandleClose,
} from '@/lib/ui/candle-countdown';
import { useTradingStore } from '@/store/trading-store';

export function NowBar() {
    const signals = useTradingStore((state) => state.signals);
    const prices = useTradingStore((state) => state.prices);
    const strategyStates = useTradingStore((state) => state.strategyStates);
    const approachThresholdPercent = useTradingStore(
        (state) => state.settings.approachThresholdPercent
    );
    const acknowledgedEntrySignalIds = useTradingStore(
        (state) => state.acknowledgedEntrySignalIds
    );
    const showZones = useTradingStore((state) => state.showZones);
    const acknowledgeEntrySignal = useTradingStore((state) => state.acknowledgeEntrySignal);
    const focusSignal = useTradingStore((state) => state.focusSignal);
    const setSelectedCoin = useTradingStore((state) => state.setSelectedCoin);
    const setSelectedTimeframe = useTradingStore((state) => state.setSelectedTimeframe);
    const setShowAllMarkets = useTradingStore((state) => state.setShowAllMarkets);
    const toggleZones = useTradingStore((state) => state.toggleZones);
    const [now, setNow] = useState(0);
    const [stableSelection, setStableSelection] = useState<StableNowBarSelection | null>(null);

    useEffect(() => {
        let timeoutId: number | null = null;
        const tick = () => {
            const tickTime = Date.now();
            setNow(tickTime);
            timeoutId = window.setTimeout(tick, 1000 - (tickTime % 1000));
        };
        timeoutId = window.setTimeout(tick, 0);
        return () => {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
        };
    }, []);

    const formingSetups = useMemo(
        () => deriveFormingSetups(strategyStates, prices),
        [prices, strategyStates]
    );
    const breakFormingSetups = useMemo(
        () => deriveBreakFormingSetups(strategyStates, prices),
        [prices, strategyStates]
    );
    const candidateItem = useMemo(() => selectNowBarItem({
        signals,
        prices,
        formingSetups,
        breakFormingSetups,
        acknowledgedEntrySignalIds: new Set(acknowledgedEntrySignalIds),
        approachThresholdPercent,
    }), [
        acknowledgedEntrySignalIds,
        approachThresholdPercent,
        breakFormingSetups,
        formingSetups,
        prices,
        signals,
    ]);
    useEffect(() => {
        const updateTimer = window.setTimeout(() => {
            setStableSelection((previous) => stabilizeNowBarItem(
                previous,
                candidateItem,
                now > 0 ? now : Date.now(),
                prices
            ));
        }, 0);
        return () => window.clearTimeout(updateTimer);
    }, [candidateItem, now, prices]);
    const item = stableSelection
        ? (
            isSameNowBarItem(stableSelection.item, candidateItem)
                ? candidateItem
                : stableSelection.item
        )
        : candidateItem;

    const handleOpen = () => {
        revealNowBarItem(item, {
            setShowAllMarkets,
            acknowledgeEntrySignal,
            focusSignal,
            setSelectedCoin,
            setSelectedTimeframe,
            ensureZonesVisible: () => {
                if (!showZones) toggleZones();
            },
            focusChart: focusStrategyChart,
        });
    };

    const content = (() => {
        if (item.kind === 'ENTRY_HIT') {
            return `⚡ ENTRY HIT — ${item.signal.direction} ${item.signal.coin} @ ${formatPrice(item.signal.entryPrice)} · tap to view`;
        }
        if (item.kind === 'APPROACHING_ENTRY') {
            return `⚡ GET READY — ${item.signal.direction} ${item.signal.coin} ${item.signal.timeframe} is near entry · tap to view`;
        }
        if (item.kind === 'BREAK_FORMING') {
            return `BREAK FORMING — ${item.setup.coin} ${item.setup.timeframe} is nearest to confirming · tap to view`;
        }
        if (item.kind === 'FORMING') {
            const zoneType = item.setup.zone.type.toLowerCase();
            const liveProximity = getZoneProximity(
                item.setup.zone,
                prices[item.setup.coin]
            );
            const location = formatFormingSetupPricePosition(
                liveProximity.distancePercent,
                liveProximity.priceRelation
            );
            return `Closest setup: ${item.setup.coin} ${item.setup.timeframe} ${zoneType}, ${location} · tap to view`;
        }
        const countdown = now > 0
            ? formatCandleCountdown(getMillisecondsUntilCandleClose(now, '1h'))
            : '--:--';
        return `Nothing to do — next 1h candle closes in ${countdown}`;
    })();

    const active = item.kind !== 'IDLE';
    const urgent = item.kind === 'ENTRY_HIT';
    const className = urgent
        ? 'border-amber-300/70 bg-amber-300/15 text-amber-100'
        : item.kind === 'APPROACHING_ENTRY' || item.kind === 'BREAK_FORMING'
            ? 'border-amber-400/40 bg-amber-400/10 text-amber-100'
            : 'border-sky-400/30 bg-sky-400/10 text-sky-100';

    return (
        <div
            className="material-chrome sticky top-0 z-40"
            role={active ? 'status' : undefined}
            aria-live={active ? 'polite' : undefined}
        >
            <div className={`border-b transition-colors duration-300 ${className}`}>
                <div className="mx-auto max-w-[1800px] px-4 sm:px-6">
                    {active ? (
                        <button
                            type="button"
                            onClick={handleOpen}
                            className="w-full py-2 text-left text-sm font-bold tracking-wide sm:text-center"
                        >
                            {content}
                        </button>
                    ) : (
                        <p className="py-2 text-sm font-semibold sm:text-center">{content}</p>
                    )}
                </div>
            </div>
        </div>
    );
}
