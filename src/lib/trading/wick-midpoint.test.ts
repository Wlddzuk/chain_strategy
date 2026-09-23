import { describe, expect, it } from 'vitest';
import { findWickMidpoints, summarizeWickMidpoints } from './wick-midpoint';
import { Candle } from './types';

const HOUR = 60 * 60 * 1000;

function bar(index: number, open: number, high: number, low: number, close: number): Candle {
    return { time: index * HOUR, open, high, low, close, volume: 1 };
}

/** Quiet candles: range 1, wicks well under half the range. */
function quiet(from: number, count: number, level = 100): Candle[] {
    return Array.from({ length: count }, (_, offset) =>
        bar(from + offset, level, level + 0.6, level - 0.4, level + 0.2)
    );
}

// Drop into a candle whose lower wick runs 99.8 -> 97.8: the half-wick is 98.8.
const WICK_INDEX = 22;
const lowerWickCandle = bar(WICK_INDEX, 99.8, 100.1, 97.8, 100);

describe('50% wick levels', () => {
    it('marks half of a long lower wick after a drop', () => {
        const candles = [...quiet(0, 22, 100), lowerWickCandle, ...quiet(23, 3, 100.5)];
        const level = findWickMidpoints(candles).find((item) => item.index === WICK_INDEX);

        expect(level).toMatchObject({ type: 'BULLISH', wickStart: 99.8, wickEnd: 97.8, status: 'OPEN' });
        expect(level?.midpoint).toBeCloseTo(98.8);
    });

    it('records the return to half, and whether the wick tip held', () => {
        const held = [...quiet(0, 22), lowerWickCandle, bar(23, 100, 100.2, 98.7, 99.5), ...quiet(24, 12, 99.5)];
        expect(findWickMidpoints(held).find((item) => item.index === WICK_INDEX))
            .toMatchObject({ status: 'FILLED', filledAt: 23 * HOUR, heldAfterFill: true });

        const lost = [...quiet(0, 22), lowerWickCandle, bar(23, 100, 100.2, 98.7, 99.5), bar(24, 99.5, 99.6, 97, 97.2), ...quiet(25, 12, 97.2)];
        expect(findWickMidpoints(lost).find((item) => item.index === WICK_INDEX))
            .toMatchObject({ status: 'FILLED', heldAfterFill: false });
    });

    it('leaves the hold undecided until enough candles have closed', () => {
        const candles = [...quiet(0, 22), lowerWickCandle, bar(23, 100, 100.2, 98.7, 99.5), ...quiet(24, 2, 99.5)];
        expect(findWickMidpoints(candles).find((item) => item.index === WICK_INDEX)?.heldAfterFill).toBeNull();
    });

    it('ignores ordinary wicks', () => {
        const candles = [...quiet(0, 22), bar(WICK_INDEX, 99.8, 100.1, 99.4, 100), ...quiet(23, 3)];
        expect(findWickMidpoints(candles).find((item) => item.index === WICK_INDEX)).toBeUndefined();
    });

    it('needs the wick to come out of a drop, not float above recent lows', () => {
        const candles = [...quiet(0, 20), bar(20, 100, 100.6, 96, 100.2), ...quiet(21, 1), lowerWickCandle, ...quiet(23, 3)];
        expect(findWickMidpoints(candles).find((item) => item.index === WICK_INDEX)).toBeUndefined();
    });

    it('marks half of a long upper wick after a push up', () => {
        const candles = [...quiet(0, 22), bar(WICK_INDEX, 100.2, 102.2, 100, 100), ...quiet(23, 3, 99.5)];
        const level = findWickMidpoints(candles).find((item) => item.index === WICK_INDEX);
        expect(level).toMatchObject({ type: 'BEARISH', wickStart: 100.2, wickEnd: 102.2 });
        expect(level?.midpoint).toBeCloseTo(101.2);
    });

    it('does not start a level on the candle that is still forming', () => {
        const candles = [...quiet(0, 22), lowerWickCandle];
        expect(findWickMidpoints(candles)).toEqual([]);
    });

    it('summarises how often the wicks came back to half', () => {
        const held = [...quiet(0, 22), lowerWickCandle, bar(23, 100, 100.2, 98.7, 99.5), ...quiet(24, 12, 99.5)];
        expect(summarizeWickMidpoints(findWickMidpoints(held))).toEqual({ total: 1, filled: 1, held: 1, decided: 1 });
    });
});
