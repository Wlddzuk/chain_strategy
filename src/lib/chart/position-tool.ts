import type { Candle } from '@/lib/trading/types';

export type PositionSide = 'long' | 'short';
export type PositionHandle = 'body' | 'entry' | 'stop' | 'target' | 'width';

export interface PositionLevels {
    side: PositionSide;
    entryTime: number;
    endTime: number;
    entry: number;
    stop: number;
    target: number;
}

/** Maps candle times to chart logical indexes, including the empty space right of the last candle. */
export interface TimeAnchor {
    time: number;
    index: number;
    stepMs: number;
}

export type PositionOutcome =
    | { state: 'waiting' }
    | { state: 'open'; fillTime: number; lastTime: number; lastPrice: number; r: number }
    | { state: 'target' | 'stop'; fillTime: number; exitTime: number; exitPrice: number; r: number };

export interface PositionGeometry {
    left: number;
    right: number;
    entryY: number;
    stopY: number;
    targetY: number;
}

export const DEFAULT_POSITION_BARS = 24;
export const DEFAULT_POSITION_RR = 2;
const DEFAULT_STOP_ATR_MULTIPLE = 1.5;
const ATR_LOOKBACK = 14;
const HANDLE_HIT_RADIUS = 9;
const EDGE_HIT_DISTANCE = 6;

export function timeToLogical(anchor: TimeAnchor, time: number): number {
    return anchor.index + ((time - anchor.time) / anchor.stepMs);
}

export function logicalToTime(anchor: TimeAnchor, logical: number): number {
    return anchor.time + ((logical - anchor.index) * anchor.stepMs);
}

export function riskRewardRatio(levels: PositionLevels): number {
    const risk = Math.abs(levels.entry - levels.stop);
    return risk === 0 ? 0 : Math.abs(levels.target - levels.entry) / risk;
}

/** Stop 1.5 average candle ranges away, target at 2R, 24 bars wide unless told otherwise. */
export function createDefaultPosition(
    side: PositionSide,
    candles: Candle[],
    time: number,
    price: number,
    stepMs: number,
    bars = DEFAULT_POSITION_BARS
): PositionLevels {
    const recent = candles.slice(-ATR_LOOKBACK);
    const averageRange = recent.length > 0
        ? recent.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / recent.length
        : price * 0.01;
    // Keep the stop above zero on a long and away from the entry on a flat market.
    const risk = Math.min(Math.max(averageRange * DEFAULT_STOP_ATR_MULTIPLE, price * 0.001), price * 0.5);
    const direction = side === 'long' ? 1 : -1;

    return {
        side,
        entryTime: time,
        endTime: time + (stepMs * bars),
        entry: price,
        stop: price - (direction * risk),
        target: price + (direction * risk * DEFAULT_POSITION_RR),
    };
}

/**
 * Applies a handle drag. Stop and target can never cross the entry, and the
 * box keeps at least one bar of width.
 */
export function editPosition(
    origin: PositionLevels,
    handle: PositionHandle,
    grab: { time: number; price: number },
    pointer: { time: number; price: number },
    stepMs: number
): PositionLevels {
    const isLong = origin.side === 'long';
    const minGap = Math.abs(origin.entry) * 0.001;

    if (handle === 'body') {
        const timeDelta = Math.round((pointer.time - grab.time) / stepMs) * stepMs;
        const priceDelta = pointer.price - grab.price;
        // A long's stop is the lowest level, a short's target is; neither may reach zero.
        const lowest = isLong ? origin.stop : origin.target;
        const safeDelta = lowest + priceDelta > 0 ? priceDelta : minGap - lowest;
        return {
            ...origin,
            entryTime: origin.entryTime + timeDelta,
            endTime: origin.endTime + timeDelta,
            entry: origin.entry + safeDelta,
            stop: origin.stop + safeDelta,
            target: origin.target + safeDelta,
        };
    }

    if (handle === 'width') {
        return { ...origin, endTime: Math.max(origin.entryTime + stepMs, pointer.time) };
    }

    if (handle === 'entry') {
        const low = Math.min(origin.stop, origin.target) + minGap;
        const high = Math.max(origin.stop, origin.target) - minGap;
        return { ...origin, entry: Math.min(high, Math.max(low, pointer.price)) };
    }

    // Stop sits below a long's entry and above a short's; target is the reverse.
    const belowEntry = (handle === 'stop') === isLong;
    const price = belowEntry
        ? Math.max(minGap, Math.min(pointer.price, origin.entry - minGap))
        : Math.max(pointer.price, origin.entry + minGap);
    return { ...origin, [handle]: price };
}

/**
 * Replays the candles inside the box: the trade fills when a candle trades
 * through the entry, then exits on whichever level is hit first. A candle that
 * touches both counts as the stop, since the order inside it is unknown.
 */
export function evaluatePosition(levels: PositionLevels, candles: Candle[]): PositionOutcome {
    const isLong = levels.side === 'long';
    const risk = Math.abs(levels.entry - levels.stop);
    const toR = (price: number) => risk === 0 ? 0 : ((isLong ? price - levels.entry : levels.entry - price) / risk);
    let fillTime: number | null = null;
    let last: Candle | null = null;

    for (const candle of candles) {
        if (candle.time < levels.entryTime) continue;
        if (candle.time > levels.endTime) break;
        if (fillTime === null) {
            if (candle.low > levels.entry || candle.high < levels.entry) continue;
            fillTime = candle.time;
        }
        last = candle;
        const hitStop = isLong ? candle.low <= levels.stop : candle.high >= levels.stop;
        if (hitStop) return { state: 'stop', fillTime, exitTime: candle.time, exitPrice: levels.stop, r: -1 };
        const hitTarget = isLong ? candle.high >= levels.target : candle.low <= levels.target;
        if (hitTarget) return { state: 'target', fillTime, exitTime: candle.time, exitPrice: levels.target, r: toR(levels.target) };
    }

    if (fillTime === null || last === null) return { state: 'waiting' };
    return { state: 'open', fillTime, lastTime: last.time, lastPrice: last.close, r: toR(last.close) };
}

export function positionGeometry(
    levels: PositionLevels,
    toX: (time: number) => number | null,
    toY: (price: number) => number | null
): PositionGeometry | null {
    const left = toX(levels.entryTime);
    const right = toX(levels.endTime);
    const entryY = toY(levels.entry);
    const stopY = toY(levels.stop);
    const targetY = toY(levels.target);
    if (left === null || right === null || entryY === null || stopY === null || targetY === null) return null;
    return { left, right: Math.max(right, left + 12), entryY, stopY, targetY };
}

export function hitTestPosition(geometry: PositionGeometry, x: number, y: number): PositionHandle | null {
    const { left, right, entryY, stopY, targetY } = geometry;
    const top = Math.min(stopY, targetY);
    const bottom = Math.max(stopY, targetY);
    const near = (pointX: number, pointY: number) => Math.hypot(x - pointX, y - pointY) <= HANDLE_HIT_RADIUS;
    const withinX = x >= left - EDGE_HIT_DISTANCE && x <= right + EDGE_HIT_DISTANCE;

    if (near(left, entryY)) return 'entry';
    if (near(right, entryY)) return 'width';
    if (withinX && Math.abs(y - targetY) <= EDGE_HIT_DISTANCE) return 'target';
    if (withinX && Math.abs(y - stopY) <= EDGE_HIT_DISTANCE) return 'stop';
    if (y >= top && y <= bottom && Math.abs(x - right) <= EDGE_HIT_DISTANCE) return 'width';
    if (x >= left && x <= right && y >= top && y <= bottom) return 'body';
    return null;
}
