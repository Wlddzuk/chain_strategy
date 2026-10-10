import { describe, expect, it } from 'vitest';
import { agreesWithTrend, calculateEma, detectTrend } from './trend';
import type { Candle } from './types';

function closes(values: number[]): Candle[] {
    return values.map((close, index) => ({
        time: index, open: close, high: close, low: close, close, volume: 1,
    }));
}

const rising = Array.from({ length: 60 }, (_, index) => 100 + index);
const falling = Array.from({ length: 60 }, (_, index) => 200 - index);

describe('calculateEma', () => {
    it('seeds with a simple average and then weights recent values', () => {
        expect(calculateEma([1, 2, 3], 3)).toBe(2);
        // Seed 2, then 2 + (5 - 2) * 0.5.
        expect(calculateEma([1, 2, 3, 5], 3)).toBe(3.5);
    });

    it('returns null without enough values', () => {
        expect(calculateEma([1, 2], 3)).toBeNull();
    });
});

describe('detectTrend', () => {
    it('reads a steady rise as UP and a steady fall as DOWN', () => {
        expect(detectTrend(closes(rising))).toBe('UP');
        expect(detectTrend(closes(falling))).toBe('DOWN');
    });

    it('reads a sharp drop below the slow average in a rising market as FLAT', () => {
        expect(detectTrend(closes([...rising, 120]))).toBe('FLAT');
    });

    it('returns null until the slow average has enough candles', () => {
        expect(detectTrend(closes(rising.slice(0, 49)))).toBeNull();
    });
});

describe('agreesWithTrend', () => {
    it('rejects only trades against a clear trend', () => {
        expect(agreesWithTrend('LONG', 'DOWN')).toBe(false);
        expect(agreesWithTrend('SHORT', 'UP')).toBe(false);
        expect(agreesWithTrend('LONG', 'UP')).toBe(true);
        expect(agreesWithTrend('SHORT', 'DOWN')).toBe(true);
        expect(agreesWithTrend('LONG', 'FLAT')).toBe(true);
        expect(agreesWithTrend('SHORT', null)).toBe(true);
    });
});
