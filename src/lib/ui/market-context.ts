import type { ChainSignal } from '@/lib/trading/types';

export interface FundingImpact {
    /** True when holding this direction pays funding, false when it earns it. */
    pays: boolean;
    /** Funding over a day at the current hourly rate, as a percent of position value. */
    dailyPercent: number;
    /** The same day of funding in units of the plan's risk. */
    dailyR: number;
}

/**
 * What a day of funding at the current rate means for a plan. Hyperliquid
 * charges funding every hour; positive funding is paid by longs to shorts.
 */
export function getFundingImpact(
    signal: Pick<ChainSignal, 'direction' | 'entryPrice' | 'stopLoss'>,
    fundingRatePercent: number
): FundingImpact | null {
    const stopDistancePercent = (Math.abs(signal.entryPrice - signal.stopLoss) / signal.entryPrice) * 100;
    if (!Number.isFinite(fundingRatePercent) || !Number.isFinite(stopDistancePercent) || stopDistancePercent <= 0) {
        return null;
    }

    const dailyPercent = Math.abs(fundingRatePercent) * 24;
    return {
        pays: (fundingRatePercent > 0) === (signal.direction === 'LONG') && fundingRatePercent !== 0,
        dailyPercent,
        dailyR: dailyPercent / stopDistancePercent,
    };
}

/** Compact dollars: $412M, $1.2B, $85K. */
export function formatCompactUsd(value: number): string {
    if (!Number.isFinite(value) || value < 0) return '—';
    if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
}
