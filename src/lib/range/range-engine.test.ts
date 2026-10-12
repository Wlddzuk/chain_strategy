import { describe, expect, it } from 'vitest';
import type { Candle } from '@/lib/trading/types';
import {
    DEFAULT_RANGE_PARAMS,
    replayRange,
    toRangeHistory,
    type RangeParams,
} from './range-engine';

const HOUR = 60 * 60 * 1000;
const START = Date.UTC(2026, 2, 1, 8, 0, 0);
const params: RangeParams = { ...DEFAULT_RANGE_PARAMS, pivotLookback: 3, pivotConfirm: 2 };

function candles(rows: number[][]): Candle[] {
    return rows.map(([open, high, low, close], index) => ({
        time: START + (index * HOUR), open, high, low, close, volume: 1000,
    }));
}

/**
 * A rally to a swing high of 110, then a drop to a swing low of 99. With the
 * default 1.5% distances the short entry is 108.35 (stop 111.65) and the long
 * entry is 100.485 (stop 97.515). The range confirms on the last candle, two
 * candles after the low.
 */
const RANGE_SETUP = [
    [104, 104.5, 103, 103.8],
    [103.8, 105, 103.5, 104.8],
    [104.8, 106, 104.5, 105.5],
    [105.5, 110, 105, 108],
    [108, 108.5, 104, 104.5],
    [104.5, 105, 101, 101.5],
    [101.5, 102, 99, 100],
    [100, 102, 99.6, 101.5],
    [101.5, 103, 101, 102.5],
];

describe('replayRange', () => {
    it('confirms a range once a swing high has been answered by a swing low', () => {
        const replay = replayRange(candles(RANGE_SETUP), '1h', params);

        expect(replay.ranges).toHaveLength(1);
        expect(replay.activeRange).toMatchObject({
            top: { type: 'SUPPLY', distalLine: 110, createdAt: START + (3 * HOUR) },
            bottom: { type: 'DEMAND', distalLine: 99, createdAt: START + (6 * HOUR) },
            confirmedAt: START + (9 * HOUR),
        });
        expect(replay.activeRange?.top.proximalLine).toBeCloseTo(108.35);
        expect(replay.activeRange?.bottom.proximalLine).toBeCloseTo(100.485);
        expect(replay.trades).toHaveLength(0);
        expect(replay.armed).toEqual({ short: true, long: true });
    });

    it('waits for the confirming candles before calling a swing', () => {
        const replay = replayRange(candles(RANGE_SETUP.slice(0, -1)), '1h', params);

        expect(replay.ranges).toHaveLength(0);
    });

    it('shorts the high, flips long at the low, and loses the last trade when the range breaks', () => {
        const replay = replayRange(candles([
            ...RANGE_SETUP,
            [102.5, 108.6, 102.3, 107.5],
            [107.5, 107.8, 100.3, 101],
            [101, 108.5, 100.9, 108],
            [108, 112, 107.5, 111.8],
        ]), '1h', params);

        expect(replay.trades.map((trade) => [trade.direction, trade.outcome])).toEqual([
            ['SHORT', 'WIN'],
            ['LONG', 'WIN'],
            ['SHORT', 'LOSS'],
        ]);
        // Short: just inside the high, stopped just outside it, paid where the long opens.
        expect(replay.trades[0].entryPrice).toBeCloseTo(108.35);
        expect(replay.trades[0].stopLoss).toBeCloseTo(111.65);
        expect(replay.trades[0].takeProfit).toBeCloseTo(100.485);
        expect(replay.trades[0].riskReward).toBeCloseTo(7.865 / 3.3, 2);
        // A close beyond the short's stop ends the range.
        expect(replay.ranges[0].endedAt).toBe(START + (13 * HOUR));
        expect(replay.activeRange).toBeNull();
        expect(replay.openTrade).toBeNull();
    });

    it('keeps the range through a wick, and buys again only after price is back inside', () => {
        const replay = replayRange(candles([
            ...RANGE_SETUP,
            // Runs the long's stop inside the entry candle, then closes back above the entry.
            [102.5, 103, 97, 101.5],
            [101.5, 102, 100.2, 101.8],
        ]), '1h', params);

        expect(replay.trades.map((trade) => [trade.direction, trade.outcome])).toEqual([
            ['LONG', 'LOSS'],
            ['LONG', undefined],
        ]);
        expect(replay.activeRange).not.toBeNull();
        expect(replay.openTrade).toBe(replay.trades[1]);
        // Nothing else can open while that long is running.
        expect(replay.armed).toEqual({ short: false, long: false });
    });

    it('stands aside when one candle crosses the whole range', () => {
        const replay = replayRange(candles([
            ...RANGE_SETUP,
            [102.5, 108.6, 100.2, 104],
        ]), '1h', params);

        expect(replay.trades).toHaveLength(0);
    });

    it('ignores swings that are too close together or too far apart to be a range', () => {
        const rows = candles(RANGE_SETUP);

        expect(replayRange(rows, '1h', { ...params, minRangePercent: 10 }).ranges).toHaveLength(0);
        expect(replayRange(rows, '1h', { ...params, maxRangePercent: 6 }).ranges).toHaveLength(0);
    });

    it('moves entries and stops with their settings', () => {
        const replay = replayRange(candles(RANGE_SETUP), '1h', {
            ...params, entryInsetPercent: 0, stopBufferPercent: 3,
        });

        // Entry on the swing line itself.
        expect(replay.activeRange?.top.proximalLine).toBe(110);
        expect(replay.activeRange?.bottom.proximalLine).toBe(99);
    });

    it('can demand an engulfing candle at each swing', () => {
        // The high turned on a bearish engulfing; the low did not turn on a bullish one.
        const strict = replayRange(candles(RANGE_SETUP), '1h', { ...params, requireEngulfing: true });
        expect(strict.ranges).toHaveLength(0);

        const withEngulfingLow = RANGE_SETUP.map((row, index) => index === 7 ? [99.9, 102.5, 99.6, 102] : row);
        const confirmed = replayRange(candles(withEngulfingLow), '1h', { ...params, requireEngulfing: true });
        expect(confirmed.ranges).toHaveLength(1);
    });
});

describe('toRangeHistory', () => {
    it('reports finished trades in R and leaves open ones out', () => {
        const replay = replayRange(candles([
            ...RANGE_SETUP,
            [102.5, 108.6, 102.3, 107.5],
            [107.5, 107.8, 100.3, 101],
        ]), '1h', params);

        const history = toRangeHistory(replay.trades, 'NEAR', '1h');

        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({
            coin: 'NEAR',
            timeframe: '1h',
            direction: 'SHORT',
            outcome: 'WIN',
            closedAt: START + (11 * HOUR),
        });
        expect(history[0].rMultiple).toBeCloseTo(7.865 / 3.3, 2);
        expect(history[0].stopDistancePercent).toBeCloseTo((3.3 / 108.35) * 100, 2);
    });
});
