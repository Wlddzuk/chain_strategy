import type { Candle } from '@/lib/trading/types';

/** Reject incomplete or inconsistent exchange bars before they reach the chart. */
export function parseHyperliquidCandle(value: unknown): Candle | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const numeric = (field: string) => {
        const value = raw[field];
        return (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
            ? Number(value)
            : NaN;
    };
    const candle: Candle = {
        time: numeric('t'),
        open: numeric('o'),
        high: numeric('h'),
        low: numeric('l'),
        close: numeric('c'),
        volume: numeric('v'),
    };
    if (!Object.values(candle).every(Number.isFinite)) return null;
    if (!Number.isSafeInteger(candle.time) || candle.time < 0 || candle.volume < 0) return null;
    if (candle.low <= 0 || candle.low > Math.min(candle.open, candle.close)) return null;
    if (candle.high < Math.max(candle.open, candle.close)) return null;
    return candle;
}
