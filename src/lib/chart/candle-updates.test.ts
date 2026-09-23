import { describe, expect, it } from 'vitest';
import type { Candle } from '@/lib/trading/types';
import { canUpdateLastCandle } from './candle-updates';

const bars: Candle[] = [1, 2, 3].map((time) => ({ time, open: 100, high: 105, low: 95, close: 101, volume: 10 }));
describe('chart candle refreshes', () => {
    it('updates only the last bar for live ticks and a single new bar', () => {
        expect(canUpdateLastCandle(bars, [...bars.slice(0, -1), { ...bars[2], close: 102 }])).toBe(true);
        expect(canUpdateLastCandle(bars, [...bars, { ...bars[2], time: 4 }])).toBe(true);
    });
    it('rebuilds the chart after a corrected historical candle', () => {
        expect(canUpdateLastCandle(bars, bars.map((bar, i) => i === 0 ? { ...bar, close: 102 } : bar))).toBe(false);
    });
    it('rebuilds for a rolling window or a batch of new bars', () => {
        expect(canUpdateLastCandle(bars, [...bars.slice(1), { ...bars[2], time: 4 }])).toBe(false);
        expect(canUpdateLastCandle(bars, [...bars, { ...bars[2], time: 4 }, { ...bars[2], time: 5 }])).toBe(false);
    });
});
