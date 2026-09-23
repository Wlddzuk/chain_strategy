// 50% wick levels
// Walid's rule: when a drop leaves a long lower wick, price tends to come back
// to half of that wick before it rises. Mirror for a long upper wick after a
// push up. The level is half of the WICK (body edge to wick tip), not half of
// the whole candle.

import { Candle, getCandleRange, getLowerWick, getUpperWick } from './types';

export interface WickMidpoint {
    /** BULLISH = lower wick after a drop; BEARISH = upper wick after a push up. */
    type: 'BULLISH' | 'BEARISH';
    index: number;
    time: number;
    /** Where the wick leaves the body. */
    wickStart: number;
    /** The wick's tip: the candle low (bullish) or high (bearish). */
    wickEnd: number;
    midpoint: number;
    /** OPEN = price has not come back to the midpoint yet. */
    status: 'OPEN' | 'FILLED';
    filledAt?: number;
    /**
     * After the fill, did price hold the wick's tip for the next `holdBars`
     * closes? null while there are not enough closes to tell.
     */
    heldAfterFill?: boolean | null;
}

export interface WickMidpointOptions {
    /** Wick as a share of its own candle's range. */
    minWickShare?: number;
    /** Wick against the average range of the previous `averageBars` candles. */
    minWickVsAverage?: number;
    averageBars?: number;
    /** The wick must reach the lowest low (highest high) of this many previous candles — the drop. */
    dropBars?: number;
    holdBars?: number;
}

const DEFAULTS: Required<WickMidpointOptions> = {
    minWickShare: 0.5,
    minWickVsAverage: 0.6,
    averageBars: 20,
    dropBars: 3,
    holdBars: 10,
};

/**
 * Finds every qualifying wick in closed candles and tracks whether price has
 * come back to its midpoint. The last candle is treated as still forming and
 * never starts a level, but it can fill one.
 */
export function findWickMidpoints(candles: Candle[], options: WickMidpointOptions = {}): WickMidpoint[] {
    const o = { ...DEFAULTS, ...options };
    const levels: WickMidpoint[] = [];

    for (let i = Math.max(o.dropBars, 5); i < candles.length - 1; i++) {
        const candle = candles[i];
        const range = getCandleRange(candle);
        if (range <= 0) continue;
        const previous = candles.slice(Math.max(0, i - o.averageBars), i);
        const averageRange = previous.reduce((sum, bar) => sum + getCandleRange(bar), 0) / previous.length;
        const recent = candles.slice(i - o.dropBars, i);

        const lowerWick = getLowerWick(candle);
        if (
            lowerWick >= range * o.minWickShare &&
            lowerWick >= averageRange * o.minWickVsAverage &&
            recent.every((bar) => candle.low <= bar.low)
        ) {
            levels.push(trackLevel(candles, i, 'BULLISH', Math.min(candle.open, candle.close), candle.low, o.holdBars));
        }

        const upperWick = getUpperWick(candle);
        if (
            upperWick >= range * o.minWickShare &&
            upperWick >= averageRange * o.minWickVsAverage &&
            recent.every((bar) => candle.high >= bar.high)
        ) {
            levels.push(trackLevel(candles, i, 'BEARISH', Math.max(candle.open, candle.close), candle.high, o.holdBars));
        }
    }

    return levels;
}

function trackLevel(
    candles: Candle[],
    index: number,
    type: WickMidpoint['type'],
    wickStart: number,
    wickEnd: number,
    holdBars: number
): WickMidpoint {
    const bullish = type === 'BULLISH';
    const midpoint = (wickStart + wickEnd) / 2;
    const level: WickMidpoint = { type, index, time: candles[index].time, wickStart, wickEnd, midpoint, status: 'OPEN' };

    for (let j = index + 1; j < candles.length; j++) {
        const reached = bullish ? candles[j].low <= midpoint : candles[j].high >= midpoint;
        if (!reached) continue;
        level.status = 'FILLED';
        level.filledAt = candles[j].time;
        // The fill candle itself counts toward the hold window.
        const after = candles.slice(j, j + holdBars);
        const lostTip = after.some((bar) => (bullish ? bar.close < wickEnd : bar.close > wickEnd));
        level.heldAfterFill = lostTip ? false : after.length >= holdBars ? true : null;
        break;
    }

    return level;
}

export interface WickMidpointRecord {
    total: number;
    filled: number;
    held: number;
    decided: number;
}

/** How often the wicks on this chart came back to half, and held once they did. */
export function summarizeWickMidpoints(levels: WickMidpoint[]): WickMidpointRecord {
    const filled = levels.filter((level) => level.status === 'FILLED');
    const decided = filled.filter((level) => level.heldAfterFill !== null && level.heldAfterFill !== undefined);
    return {
        total: levels.length,
        filled: filled.length,
        held: decided.filter((level) => level.heldAfterFill).length,
        decided: decided.length,
    };
}
