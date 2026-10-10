import type { Candle, ChainSignal } from './types';

export type Trend = 'UP' | 'DOWN' | 'FLAT';

export const TREND_FAST_PERIOD = 20;
export const TREND_SLOW_PERIOD = 50;

/** Final exponential moving average of the series, seeded with a simple average. */
export function calculateEma(values: readonly number[], period: number): number | null {
    if (!Number.isInteger(period) || period < 1 || values.length < period) return null;

    const multiplier = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    for (const value of values.slice(period)) {
        ema += (value - ema) * multiplier;
    }
    return Number.isFinite(ema) ? ema : null;
}

/**
 * Trend of closed candles: UP when the last close is above the slow EMA and
 * the fast EMA is above the slow one, DOWN when both are below, FLAT when the
 * two disagree. Null until there are enough candles for the slow EMA.
 */
export function detectTrend(candles: readonly Candle[]): Trend | null {
    const closes = candles.map((candle) => candle.close);
    const fast = calculateEma(closes, TREND_FAST_PERIOD);
    const slow = calculateEma(closes, TREND_SLOW_PERIOD);
    const lastClose = closes.at(-1);
    if (fast === null || slow === null || lastClose === undefined) return null;

    if (lastClose > slow && fast > slow) return 'UP';
    if (lastClose < slow && fast < slow) return 'DOWN';
    return 'FLAT';
}

/** Only a trade against a clear trend disagrees; a flat or unknown trend blocks nothing. */
export function agreesWithTrend(direction: ChainSignal['direction'], trend: Trend | null): boolean {
    return !(direction === 'LONG' && trend === 'DOWN') &&
        !(direction === 'SHORT' && trend === 'UP');
}
