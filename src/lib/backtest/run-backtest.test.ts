import { describe, expect, it } from 'vitest';
import type { Candle } from '@/lib/trading/types';
import {
    BACKTEST_WINDOW,
    advanceMarketBacktest,
    countOpenPlans,
    createMarketBacktest,
    isMarketBacktestDone,
} from './run-backtest';

const HOUR = 60 * 60 * 1000;
const START = Date.UTC(2026, 2, 1, 8, 0, 0);
const settings = { minStopDistancePercent: 0, maxRiskRewardRatio: 100 };

function candle(index: number, open: number, high: number, low: number, close: number): Candle {
    return { time: START + (index * HOUR), open, high, low, close, volume: 1000 };
}

/**
 * Flat warm-up history, then a break that fires a LONG plan at the close of the
 * last candle: entry 98, stop about 96.70, target 105.
 */
function longSetup(): Candle[] {
    const warmUp = Array.from({ length: BACKTEST_WINDOW - 1 }, (_, index) => candle(index, 103, 103, 103, 103));
    const setup = [
        [105, 106.5, 104.5, 106],
        [106.2, 106.4, 103.8, 104],
        [100, 101.2, 99.8, 101],
        [101.1, 101.3, 99.4, 99.5],
        [99.5, 99.7, 97.5, 98],
        [98, 98.2, 96.8, 97],
        [97, 100.2, 96.9, 100],
        [100, 102.2, 99.8, 102],
    ].map(([open, high, low, close], offset) => candle(warmUp.length + offset, open, high, low, close));
    return [...warmUp, ...setup];
}

/** Runs the setup followed by `after` candles given as [open, high, low, close]. */
function run(after: number[][]) {
    const base = longSetup();
    const candles = [
        ...base,
        ...after.map(([open, high, low, close], offset) => candle(base.length + offset, open, high, low, close)),
    ];
    const backtest = createMarketBacktest({ coin: 'BTC', timeframe: '1h', candles, settings });
    advanceMarketBacktest(backtest, Infinity);
    return backtest;
}

describe('market backtest', () => {
    it('opens the plan the live scanner would and leaves it open when nothing happens', () => {
        const backtest = run([[102, 102.5, 101.5, 102]]);

        expect(isMarketBacktestDone(backtest)).toBe(true);
        expect(backtest.results).toHaveLength(0);
        expect(countOpenPlans(backtest)).toBe(1);
    });

    it('records a win when price fills the entry and later reaches the target', () => {
        const backtest = run([
            [102, 102.2, 97.9, 99],
            [99, 105.2, 98.8, 105],
        ]);

        expect(backtest.results).toHaveLength(1);
        expect(backtest.results[0]).toMatchObject({
            coin: 'BTC',
            timeframe: '1h',
            direction: 'LONG',
            outcome: 'WIN',
        });
        expect(backtest.results[0].rMultiple).toBeCloseTo(5.4, 1);
        expect(backtest.results[0].stopDistancePercent).toBeCloseTo(1.32, 2);
        expect(countOpenPlans(backtest)).toBe(0);
    });

    it('records a loss when a candle runs through both entry and stop', () => {
        const backtest = run([[102, 102.2, 96, 96.5]]);

        expect(backtest.results).toMatchObject([{ outcome: 'LOSS', rMultiple: -1 }]);
    });

    it('settles a filled plan against the trader when one candle spans stop and target', () => {
        const backtest = run([
            [102, 102.2, 97.9, 99],
            [99, 105.5, 96, 100],
        ]);

        expect(backtest.results).toMatchObject([{ outcome: 'LOSS' }]);
    });

    it('records a miss, with how near price came, when the target is reached first', () => {
        const backtest = run([
            [102, 102.5, 98.98, 102],
            [102, 105.5, 101.8, 105],
        ]);

        expect(backtest.results).toMatchObject([{ outcome: 'MISSED', rMultiple: 0 }]);
        // Nearest low 98.98 is 1% above the 98 entry; the stop is 1.32% away.
        expect(backtest.results[0].missedByR).toBeCloseTo(1 / 1.3233, 2);
    });

    it('measures the gap even when the plan is missed on its first candle', () => {
        const backtest = run([[102, 105.5, 99.96, 105]]);

        expect(backtest.results).toMatchObject([{ outcome: 'MISSED' }]);
        expect(backtest.results[0].missedByR).toBeCloseTo(2 / 1.3233, 2);
    });

    it('counts entry and target inside one candle as an ambiguous miss', () => {
        const backtest = run([[102, 105.5, 97.9, 104]]);

        expect(backtest.results).toMatchObject([{ outcome: 'MISSED' }]);
        expect(backtest.ambiguous).toBe(1);
    });

    it('can be advanced in slices and gives the same result as one pass', () => {
        const after = [[102, 102.2, 97.9, 99], [99, 105.2, 98.8, 105]];
        const base = longSetup();
        const candles = [
            ...base,
            ...after.map(([open, high, low, close], offset) => candle(base.length + offset, open, high, low, close)),
        ];
        const sliced = createMarketBacktest({ coin: 'BTC', timeframe: '1h', candles, settings });
        while (!advanceMarketBacktest(sliced, 3)) { /* keep slicing */ }

        expect(sliced.results).toEqual(run(after).results);
    });

    it('has nothing to replay without enough history for the scanner window', () => {
        const backtest = createMarketBacktest({
            coin: 'BTC', timeframe: '1h', candles: longSetup().slice(0, 50), settings,
        });

        expect(isMarketBacktestDone(backtest)).toBe(true);
    });
});
