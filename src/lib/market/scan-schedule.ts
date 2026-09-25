import { getMoveToEntryPercent } from '@/lib/trading/entry-distance';
import type { ChainSignal, Timeframe } from '@/lib/trading/types';
import { getTimeframeMs } from '@/lib/trading/types';

export function getEligibleScanBoundary(
    now: number,
    timeframe: Timeframe,
    graceMs = 5000
): number {
    const duration = getTimeframeMs(timeframe);
    return Math.floor((now - graceMs) / duration) * duration;
}

export function getBackgroundScanTimeframes(
    selectedTimeframe: Timeframe,
    configuredTimeframes: Timeframe[]
): Timeframe[] {
    return Array.from(new Set([selectedTimeframe, ...configuredTimeframes]));
}

export function shouldUseFastPricePolling(
    signals: ChainSignal[],
    prices: Record<string, number>
): boolean {
    return signals.some((signal) => {
        if (signal.status !== 'PENDING' && signal.status !== 'APPROVED') return false;
        const price = prices[signal.coin];
        if (!Number.isFinite(price) || price <= 0 || signal.entryPrice === 0) return false;
        return Math.abs(getMoveToEntryPercent(price, signal.entryPrice)) <= 0.5;
    });
}
