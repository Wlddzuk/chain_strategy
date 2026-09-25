import { describe, expect, it } from 'vitest';
import type { Candle } from '@/lib/trading/types';
import {
    DEFAULT_POSITION_BARS,
    createDefaultPosition,
    editPosition,
    evaluatePosition,
    hitTestPosition,
    logicalToTime,
    riskRewardRatio,
    timeToLogical,
    type PositionLevels,
} from './position-tool';

const HOUR = 3_600_000;
const START = Date.UTC(2026, 8, 1, 0, 0, 0);

function candle(index: number, low: number, high: number, close = (low + high) / 2): Candle {
    return { time: START + (index * HOUR), open: close, high, low, close, volume: 1 };
}

const long: PositionLevels = { side: 'long', entryTime: START, endTime: START + (10 * HOUR), entry: 100, stop: 95, target: 110 };
const short: PositionLevels = { side: 'short', entryTime: START, endTime: START + (10 * HOUR), entry: 100, stop: 105, target: 90 };

describe('position tool', () => {
    it('places a default long with the stop below, a 2R target and 24 bars of width', () => {
        const candles = Array.from({ length: 14 }, (_, index) => candle(index, 98, 102));
        const position = createDefaultPosition('long', candles, START, 100, HOUR);
        expect(position.stop).toBeCloseTo(94);
        expect(position.target).toBeCloseTo(112);
        expect(riskRewardRatio(position)).toBeCloseTo(2);
        expect(position.endTime - position.entryTime).toBe(DEFAULT_POSITION_BARS * HOUR);
    });

    it('mirrors the default levels for a short', () => {
        const candles = Array.from({ length: 14 }, (_, index) => candle(index, 98, 102));
        const position = createDefaultPosition('short', candles, START, 100, HOUR);
        expect(position.stop).toBeCloseTo(106);
        expect(position.target).toBeCloseTo(88);
    });

    it('converts times beyond the last candle to logical indexes and back', () => {
        const anchor = { time: START, index: 50, stepMs: HOUR };
        expect(timeToLogical(anchor, START + (3.5 * HOUR))).toBeCloseTo(53.5);
        expect(logicalToTime(anchor, 53.5)).toBe(START + (3.5 * HOUR));
    });

    it('never lets the stop or target cross the entry', () => {
        const grab = { time: START, price: 95 };
        expect(editPosition(long, 'stop', grab, { time: START, price: 120 }, HOUR).stop).toBeLessThan(100);
        expect(editPosition(long, 'target', grab, { time: START, price: 80 }, HOUR).target).toBeGreaterThan(100);
        expect(editPosition(short, 'stop', grab, { time: START, price: 80 }, HOUR).stop).toBeGreaterThan(100);
        expect(editPosition(short, 'target', grab, { time: START, price: 120 }, HOUR).target).toBeLessThan(100);
        const entry = editPosition(long, 'entry', grab, { time: START, price: 200 }, HOUR).entry;
        expect(entry).toBeLessThan(110);
        expect(entry).toBeGreaterThan(95);
    });

    it('moves the whole box with the body, snapping time to whole bars', () => {
        const moved = editPosition(long, 'body', { time: START, price: 100 }, { time: START + (2.4 * HOUR), price: 103 }, HOUR);
        expect(moved.entryTime).toBe(START + (2 * HOUR));
        expect(moved.endTime).toBe(long.endTime + (2 * HOUR));
        expect([moved.entry, moved.stop, moved.target]).toEqual([103, 98, 113]);
    });

    it('keeps at least one bar of width', () => {
        const narrowed = editPosition(long, 'width', { time: START, price: 100 }, { time: START - HOUR, price: 100 }, HOUR);
        expect(narrowed.endTime).toBe(START + HOUR);
    });

    it('waits until price trades through the entry', () => {
        expect(evaluatePosition(long, [candle(0, 101, 104), candle(1, 102, 106)])).toEqual({ state: 'waiting' });
    });

    it('reports a target hit in R multiples', () => {
        const outcome = evaluatePosition(long, [candle(0, 99, 101), candle(1, 100, 104), candle(2, 103, 111)]);
        expect(outcome).toMatchObject({ state: 'target', fillTime: START, exitTime: START + (2 * HOUR), r: 2 });
    });

    it('counts a candle that touches both levels as stopped out', () => {
        const outcome = evaluatePosition(short, [candle(0, 99, 101), candle(1, 89, 106)]);
        expect(outcome).toMatchObject({ state: 'stop', r: -1 });
    });

    it('ignores candles after the box ends and shows open R before that', () => {
        const outcome = evaluatePosition(long, [candle(0, 99, 101, 100), candle(5, 101, 103, 102.5), candle(11, 80, 120)]);
        expect(outcome).toMatchObject({ state: 'open', lastPrice: 102.5, r: 0.5 });
    });

    it('hit-tests handles, edges and the body', () => {
        const geometry = { left: 100, right: 300, entryY: 200, stopY: 250, targetY: 100 };
        expect(hitTestPosition(geometry, 102, 201)).toBe('entry');
        expect(hitTestPosition(geometry, 298, 200)).toBe('width');
        expect(hitTestPosition(geometry, 200, 103)).toBe('target');
        expect(hitTestPosition(geometry, 200, 247)).toBe('stop');
        expect(hitTestPosition(geometry, 302, 150)).toBe('width');
        expect(hitTestPosition(geometry, 200, 160)).toBe('body');
        expect(hitTestPosition(geometry, 200, 300)).toBeNull();
    });
});
