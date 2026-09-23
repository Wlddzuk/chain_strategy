// Pattern Detection Module
// Implements engulfing candle and pin bar detection for the Chain Strategy

import {
    Candle,
    EngulfingPattern,
    PinBar,
    FormationType,
    getCandleDirection,
    getCandleBody,
    getCandleRange,
    getUpperWick,
    getLowerWick,
} from './types';

/**
 * Detects bullish and bearish engulfing patterns in candle data
 * Engulfing: A candle whose body completely covers the previous candle's body
 */
export function detectEngulfingPatterns(candles: Candle[]): EngulfingPattern[] {
    const patterns: EngulfingPattern[] = [];

    for (let i = 1; i < candles.length; i++) {
        const current = candles[i];
        const previous = candles[i - 1];

        const currentDir = getCandleDirection(current);
        const previousDir = getCandleDirection(previous);

        // Skip if same direction or doji
        if (currentDir === previousDir || currentDir === 'DOJI' || previousDir === 'DOJI') {
            continue;
        }

        const currentBodyTop = Math.max(current.open, current.close);
        const currentBodyBottom = Math.min(current.open, current.close);
        const previousBodyTop = Math.max(previous.open, previous.close);
        const previousBodyBottom = Math.min(previous.open, previous.close);

        const currentBody = getCandleBody(current);
        const previousBody = getCandleBody(previous);
        const bodyEngulfs = currentBodyTop >= previousBodyTop && currentBodyBottom <= previousBodyBottom;
        const rangeEngulfs = current.high >= previous.high && current.low <= previous.low;
        const isBiggerBody = currentBody > previousBody;

        // Check for bullish engulfing: green candle after red and bigger
        if (currentDir === 'BULLISH' && previousDir === 'BEARISH') {
            if ((bodyEngulfs || rangeEngulfs) && isBiggerBody) {
                patterns.push({
                    type: 'BULLISH',
                    index: i,
                    engulfingCandle: current,
                    engulfedCandle: previous,
                });
            }
        }

        // Check for bearish engulfing: red candle after green and bigger
        if (currentDir === 'BEARISH' && previousDir === 'BULLISH') {
            if ((bodyEngulfs || rangeEngulfs) && isBiggerBody) {
                patterns.push({
                    type: 'BEARISH',
                    index: i,
                    engulfingCandle: current,
                    engulfedCandle: previous,
                });
            }
        }
    }

    return patterns;
}

/**
 * Engulfing the way he marks it by eye: the engulfing body is visibly bigger —
 * at least `minBodyRatio` times the swallowed candle's body and no smaller than
 * the average body of the previous `averageBars` candles. Filters out the small
 * engulfings that `detectEngulfingPatterns` also reports.
 */
export function isDecisiveEngulfing(
    candles: Candle[],
    pattern: EngulfingPattern,
    minBodyRatio: number = 1.5,
    averageBars: number = 20
): boolean {
    const engulfingBody = getCandleBody(pattern.engulfingCandle);
    if (engulfingBody < getCandleBody(pattern.engulfedCandle) * minBodyRatio) return false;
    const previous = candles.slice(Math.max(0, pattern.index - averageBars), pattern.index);
    if (!previous.length) return true;
    const averageBody = previous.reduce((sum, candle) => sum + getCandleBody(candle), 0) / previous.length;
    return engulfingBody >= averageBody;
}

/**
 * Detects pin bar patterns
 * Pin bar: Small body with long wick (tail) indicating rejection
 * Larger tail/wick = stronger zone
 */
export function detectPinBars(candles: Candle[], minWickRatio: number = 2.0): PinBar[] {
    const pinBars: PinBar[] = [];

    for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];
        const body = getCandleBody(candle);
        const range = getCandleRange(candle);

        // Skip if no range (flat candle)
        if (range === 0) continue;

        const upperWick = getUpperWick(candle);
        const lowerWick = getLowerWick(candle);

        // Body should be small relative to range (less than 30%)
        const bodyRatio = body / range;
        if (bodyRatio > 0.3) continue;

        // Bullish pin bar: long lower wick (rejection of lower prices)
        if (lowerWick > 0 && body > 0) {
            const lowerWickRatio = lowerWick / body;
            if (lowerWickRatio >= minWickRatio && lowerWick > upperWick * 2) {
                pinBars.push({
                    type: 'BULLISH',
                    index: i,
                    candle,
                    wickRatio: lowerWickRatio,
                });
            }
        }

        // Bearish pin bar: long upper wick (rejection of higher prices)
        if (upperWick > 0 && body > 0) {
            const upperWickRatio = upperWick / body;
            if (upperWickRatio >= minWickRatio && upperWick > lowerWick * 2) {
                pinBars.push({
                    type: 'BEARISH',
                    index: i,
                    candle,
                    wickRatio: upperWickRatio,
                });
            }
        }
    }

    return pinBars;
}

/**
 * Classifies a formation pattern (RBR, DBD, DBR, RBD)
 * Looks at 3+ candles to identify the formation type
 * 
 * RBR (Rally-Base-Rally): Continuation buy - rally after base creates HH
 * DBD (Drop-Base-Drop): Continuation sell - drop after base creates LL
 * DBR (Drop-Base-Rally): Reversal buy (stronger)
 * RBD (Rally-Base-Drop): Reversal sell (stronger)
 */
export function classifyFormation(
    candles: Candle[],
    baseStartIndex: number,
    baseEndIndex: number
): FormationType {
    if (baseStartIndex < 1 || baseEndIndex >= candles.length - 1) {
        return null;
    }

    // Get the move before the base
    const preBaseCandle = candles[baseStartIndex - 1];
    const firstBaseCandle = candles[baseStartIndex];
    const preMoveDirection = preBaseCandle.close > preBaseCandle.open ? 'RALLY' : 'DROP';

    // Get the move after the base
    const postBaseCandle = candles[baseEndIndex + 1];
    const postMoveDirection = postBaseCandle.close > postBaseCandle.open ? 'RALLY' : 'DROP';

    // Check for higher high (HH) or lower low (LL) confirmation
    const preHigh = Math.max(preBaseCandle.high, firstBaseCandle.high);
    const preLow = Math.min(preBaseCandle.low, firstBaseCandle.low);
    const postHigh = postBaseCandle.high;
    const postLow = postBaseCandle.low;

    if (preMoveDirection === 'RALLY' && postMoveDirection === 'RALLY') {
        // RBR requires Higher High
        if (postHigh > preHigh) {
            return 'RBR';
        }
    } else if (preMoveDirection === 'DROP' && postMoveDirection === 'DROP') {
        // DBD requires Lower Low
        if (postLow < preLow) {
            return 'DBD';
        }
    } else if (preMoveDirection === 'DROP' && postMoveDirection === 'RALLY') {
        return 'DBR'; // Reversal buy (stronger)
    } else if (preMoveDirection === 'RALLY' && postMoveDirection === 'DROP') {
        return 'RBD'; // Reversal sell (stronger)
    }

    return null;
}

/**
 * Identifies base/consolidation candles
 * A base is a pause before a strong move - typically small-bodied candles
 */
export function identifyBase(candles: Candle[], startIndex: number): { start: number; end: number } | null {
    if (startIndex >= candles.length) return null;

    const avgRange = candles.slice(Math.max(0, startIndex - 10), startIndex)
        .reduce((sum, c) => sum + getCandleRange(c), 0) / Math.min(10, startIndex);

    const baseStart = startIndex;
    let baseEnd = startIndex;

    // Extend base while candles are small (less than 50% of average range)
    for (let i = startIndex; i < candles.length; i++) {
        const range = getCandleRange(candles[i]);
        if (range < avgRange * 0.5) {
            baseEnd = i;
        } else {
            break;
        }
    }

    // Base must be at least 1 candle
    if (baseEnd > baseStart) {
        return { start: baseStart, end: baseEnd };
    }

    return null;
}
