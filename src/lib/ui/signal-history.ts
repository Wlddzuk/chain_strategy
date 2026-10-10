import type { ChainSignal } from '@/lib/trading/types';
import { getPlanFeePercents, type FeeRates } from '@/lib/ui/trade-metrics';

export type HistoryCategory = 'won' | 'lost' | 'missed' | 'other';
export type HistoryFilter = 'all' | HistoryCategory;

/** "other" covers dismissed, invalidated, and stale plans that never resolved. */
export function getHistoryCategory(signal: ChainSignal): HistoryCategory {
    if (signal.outcome === 'WIN') return 'won';
    if (signal.outcome === 'LOSS') return 'lost';
    return signal.status === 'MISSED' ? 'missed' : 'other';
}

/**
 * R a resolved plan made or lost after fees, in units of its planned risk.
 * Null for plans that never resolved to a win or a loss.
 */
export function getHistoryNetR(signal: ChainSignal, fees: FeeRates): number | null {
    if (signal.outcome !== 'WIN' && signal.outcome !== 'LOSS') return null;

    const stopDistancePercent = (Math.abs(signal.entryPrice - signal.stopLoss) / signal.entryPrice) * 100;
    const planFees = getPlanFeePercents(fees);
    const feeR = Number.isFinite(stopDistancePercent) && stopDistancePercent > 0
        ? (signal.outcome === 'WIN' ? planFees.win : planFees.loss) / stopDistancePercent
        : 0;
    const grossR = signal.outcome === 'WIN' ? Math.max(0, signal.riskRewardRatio) : -1;
    return Number.isFinite(grossR) ? grossR - feeR : null;
}
