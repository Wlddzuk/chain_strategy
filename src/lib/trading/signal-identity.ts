import type { ChainSignal } from './types';

function normalizedLevel(value: number): string {
    return Number.isFinite(value) ? value.toPrecision(12) : String(value);
}

/**
 * Two concurrent signals with the same executable levels represent one plan,
 * even if a rolling candle snapshot changed the strategy's index-based IDs.
 */
export function getTradePlanKey(signal: ChainSignal): string {
    return [
        signal.coin,
        signal.timeframe,
        signal.direction,
        normalizedLevel(signal.entryPrice),
        normalizedLevel(signal.stopLoss),
        normalizedLevel(signal.takeProfit),
    ].join(':');
}

export function isOpenSignalWorkflow(signal: ChainSignal): boolean {
    return signal.status === 'PENDING' ||
        signal.status === 'APPROVED' ||
        (signal.status === 'TOUCHED' && !signal.outcome && !signal.closedAt) ||
        (signal.status === 'FILLED' && !signal.outcome);
}
