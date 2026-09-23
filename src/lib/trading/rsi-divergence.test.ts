import { describe, expect, it } from 'vitest';
import { detectBullishDivergence, findTripleDivergences } from './rsi-divergence';
import { Candle } from './types';

const HOUR = 60 * 60 * 1000;

/** Flat candles with swing lows (or highs) placed at chosen bars. */
function series(length: number, swings: Record<number, number>, kind: 'low' | 'high' = 'low'): Candle[] {
    return Array.from({ length }, (_, index) => {
        const swing = swings[index];
        const low = kind === 'low' && swing !== undefined ? swing : 100;
        const high = kind === 'high' && swing !== undefined ? swing : 101;
        return { time: index * HOUR, open: 100.5, high, low, close: 100.5, volume: 1 };
    });
}

/** RSI of 50 everywhere except the given bars. */
function rsiAt(length: number, values: Record<number, number>): number[] {
    return Array.from({ length }, (_, index) => values[index] ?? 50);
}

describe('three-touch RSI divergence', () => {
    it('finds lower lows while RSI stays at the same level', () => {
        const candles = series(40, { 8: 95, 18: 93, 28: 91 });
        const found = findTripleDivergences(candles, rsiAt(40, { 8: 30, 18: 30, 28: 29 }));

        expect(found).toHaveLength(1);
        expect(found[0].type).toBe('BULLISH');
        expect(found[0].touches?.map((touch) => touch.price)).toEqual([95, 93, 91]);
        expect(found[0].pricePoint1.value).toBe(95);
        expect(found[0].pricePoint2.value).toBe(91);
    });

    it('rejects it when RSI keeps falling with price', () => {
        const candles = series(40, { 8: 95, 18: 93, 28: 91 });
        expect(findTripleDivergences(candles, rsiAt(40, { 8: 30, 18: 26, 28: 22 }))).toEqual([]);
    });

    it('rejects a slow RSI slide that adds up past the tolerance', () => {
        const candles = series(50, { 8: 95, 18: 93, 28: 91, 38: 89 });
        const found = findTripleDivergences(candles, rsiAt(50, { 8: 30, 18: 28, 28: 26, 38: 24 }));
        // Each step is only 2 points, but 30 -> 26 already drifts past 3.
        expect(found.every((divergence) => (divergence.touches?.length ?? 0) < 4)).toBe(true);
        expect(found.every((divergence) =>
            divergence.rsiPoint2.value >= divergence.rsiPoint1.value - 3
        )).toBe(true);
    });

    it('needs three touches, not two', () => {
        const candles = series(30, { 8: 95, 18: 93 });
        expect(findTripleDivergences(candles, rsiAt(30, { 8: 30, 18: 30 }))).toEqual([]);
    });

    it('rates RSI rising against price above RSI merely holding', () => {
        const candles = series(40, { 8: 95, 18: 93, 28: 91 });
        const flat = findTripleDivergences(candles, rsiAt(40, { 8: 30, 18: 30, 28: 30 }))[0];
        const rising = findTripleDivergences(candles, rsiAt(40, { 8: 30, 18: 33, 28: 36 }))[0];
        expect(rising.strength).toBeGreaterThan(flat.strength);
    });

    it('keeps extending with a fourth touch', () => {
        const candles = series(50, { 8: 95, 18: 93, 28: 91, 38: 89 });
        const found = findTripleDivergences(candles, rsiAt(50, { 8: 30, 18: 30, 28: 30, 38: 30 }));
        expect(found).toHaveLength(1);
        expect(found[0].touches).toHaveLength(4);
    });

    it('finds the bearish mirror: higher highs while RSI stays level', () => {
        const candles = series(40, { 8: 105, 18: 107, 28: 109 }, 'high');
        const found = findTripleDivergences(candles, rsiAt(40, { 8: 70, 18: 70, 28: 71 }));
        expect(found).toHaveLength(1);
        expect(found[0].type).toBe('BEARISH');
    });

    it('ignores touches too far apart to be one pattern', () => {
        const candles = series(110, { 5: 95, 50: 93, 95: 91 });
        expect(findTripleDivergences(candles, rsiAt(110, { 5: 30, 50: 30, 95: 30 }))).toEqual([]);
    });

    it('ignores lower lows too small to matter', () => {
        const candles = series(40, { 8: 99.9, 18: 99.8, 28: 99.7 });
        expect(findTripleDivergences(candles, rsiAt(40, { 8: 30, 18: 30, 28: 30 }))).toEqual([]);
    });

    it('only reports a recent pattern as the current one', () => {
        const recent = series(40, { 8: 95, 18: 93, 28: 91 });
        const rsi = rsiAt(40, { 8: 30, 18: 30, 28: 30 });
        expect(detectBullishDivergence(recent, rsi)).not.toBeNull();

        const stale = [...recent, ...series(60, {}).map((bar, index) => ({ ...bar, time: (40 + index) * HOUR }))];
        expect(detectBullishDivergence(stale, [...rsi, ...rsiAt(60, {})])).toBeNull();
    });
});
