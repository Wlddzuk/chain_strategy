// RSI Calculation and Divergence Detection Module
// RSI calculation and Walid's three-touch divergence (lower lows, RSI level) for signal confirmation

import { Candle, RsiDivergence } from './types';

export interface RsiAccumulatorState {
    period: number;
    previousClose: number | null;
    changeCount: number;
    seedGain: number;
    seedLoss: number;
    averageGain: number | null;
    averageLoss: number | null;
}

export interface RsiAccumulatorStep {
    state: RsiAccumulatorState;
    value: number;
}

function assertValidPeriod(period: number): void {
    if (!Number.isInteger(period) || period < 1) {
        throw new RangeError('RSI period must be a positive integer');
    }
}

function calculateRsiValue(averageGain: number, averageLoss: number): number {
    if (averageLoss === 0) return 100;
    const relativeStrength = averageGain / averageLoss;
    return 100 - (100 / (1 + relativeStrength));
}

/**
 * Create the serializable smoothing state used by Wilder's RSI calculation.
 * `advanceRsiAccumulator` is pure, so a caller can retain a previous closed-bar
 * state and safely recompute a changing, still-forming bar from that state.
 */
export function createRsiAccumulator(period: number = 14): RsiAccumulatorState {
    assertValidPeriod(period);
    return {
        period,
        previousClose: null,
        changeCount: 0,
        seedGain: 0,
        seedLoss: 0,
        averageGain: null,
        averageLoss: null,
    };
}

/** Advance an RSI smoothing state by one close without mutating the input. */
export function advanceRsiAccumulator(
    state: RsiAccumulatorState,
    close: number
): RsiAccumulatorStep {
    if (state.previousClose === null) {
        return {
            state: { ...state, previousClose: close },
            value: NaN,
        };
    }

    const change = close - state.previousClose;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    const changeCount = state.changeCount + 1;

    if (changeCount < state.period) {
        return {
            state: {
                ...state,
                previousClose: close,
                changeCount,
                seedGain: state.seedGain + gain,
                seedLoss: state.seedLoss + loss,
            },
            value: NaN,
        };
    }

    if (changeCount === state.period) {
        const averageGain = (state.seedGain + gain) / state.period;
        const averageLoss = (state.seedLoss + loss) / state.period;
        return {
            state: {
                ...state,
                previousClose: close,
                changeCount,
                seedGain: 0,
                seedLoss: 0,
                averageGain,
                averageLoss,
            },
            value: calculateRsiValue(averageGain, averageLoss),
        };
    }

    const previousAverageGain = state.averageGain ?? 0;
    const previousAverageLoss = state.averageLoss ?? 0;
    const averageGain = ((previousAverageGain * (state.period - 1)) + gain) / state.period;
    const averageLoss = ((previousAverageLoss * (state.period - 1)) + loss) / state.period;

    return {
        state: {
            ...state,
            previousClose: close,
            changeCount,
            averageGain,
            averageLoss,
        },
        value: calculateRsiValue(averageGain, averageLoss),
    };
}

/** Build the smoothing state after consuming every supplied close. */
export function buildRsiAccumulator(
    closes: readonly number[],
    period: number = 14
): RsiAccumulatorState {
    let state = createRsiAccumulator(period);
    for (const close of closes) {
        state = advanceRsiAccumulator(state, close).state;
    }
    return state;
}

/**
 * Calculate RSI (Relative Strength Index)
 * @param closes - Array of closing prices
 * @param period - RSI period (default 14)
 * @returns Array of RSI values (first `period` values will be NaN)
 */
export function calculateRSI(closes: number[], period: number = 14): number[] {
    const rsi: number[] = new Array(closes.length).fill(NaN);

    let state = createRsiAccumulator(period);
    for (let index = 0; index < closes.length; index++) {
        const step = advanceRsiAccumulator(state, closes[index]);
        state = step.state;
        rsi[index] = step.value;
    }

    return rsi;
}

export interface TripleDivergenceOptions {
    /** Bars either side of a candle that must sit above (lows) or below (highs) it. */
    pivotBars?: number;
    /** How many RSI points the RSI may drift against the divergence across the touches. */
    rsiTolerance?: number;
    /** Largest gap, in bars, between two consecutive touches of the same pattern. */
    maxGapBars?: number;
    /** Touches required before a pattern counts. */
    minTouches?: number;
    /** First-to-last price move, in average candle ranges, below which the pattern is noise. */
    minMoveRanges?: number;
}

const TRIPLE_DIVERGENCE_DEFAULTS: Required<TripleDivergenceOptions> = {
    pivotBars: 3,
    rsiTolerance: 3,
    maxGapBars: 40,
    minTouches: 3,
    minMoveRanges: 1,
};

type DivergenceTouch = NonNullable<RsiDivergence['touches']>[number];

/** Swing lows or highs; on a tie the earlier candle is the swing. */
function findSwings(values: number[], pivotBars: number, kind: 'low' | 'high'): number[] {
    const swings: number[] = [];
    for (let i = pivotBars; i < values.length - pivotBars; i++) {
        let isSwing = Number.isFinite(values[i]);
        for (let j = i - pivotBars; j <= i + pivotBars && isSwing; j++) {
            if (j === i) continue;
            const beyond = kind === 'low' ? values[j] < values[i] : values[j] > values[i];
            if (beyond || (values[j] === values[i] && j < i)) isSwing = false;
        }
        if (isSwing) swings.push(i);
    }
    return swings;
}

/** The RSI trough (or peak) next to a price swing — the RSI low can sit a bar either side. */
function rsiNearSwing(rsi: number[], index: number, bullish: boolean): number {
    const nearby = [rsi[index - 1], rsi[index], rsi[index + 1]].filter((value) => Number.isFinite(value));
    if (!nearby.length) return NaN;
    return bullish ? Math.min(...nearby) : Math.max(...nearby);
}

function toDivergence(
    type: RsiDivergence['type'],
    touches: DivergenceTouch[],
    candles: Candle[],
    minMoveRanges: number
): RsiDivergence | null {
    const first = touches[0];
    const last = touches[touches.length - 1];
    const span = candles.slice(first.index, last.index + 1);
    const averageRange = span.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / span.length;
    if (Math.abs(last.price - first.price) < averageRange * minMoveRanges) return null;

    // Positive when RSI actually improved against price (the classic case);
    // around zero is his "RSI stays at the same level" case.
    const rsiEdge = type === 'BULLISH' ? last.rsi - first.rsi : first.rsi - last.rsi;
    const strength = Math.round(Math.max(0, Math.min(100,
        50 + (15 * (touches.length - 3)) + (3 * Math.max(-3, Math.min(10, rsiEdge)))
    )));

    return {
        type,
        pricePoint1: { index: first.index, value: first.price, time: first.time },
        pricePoint2: { index: last.index, value: last.price, time: last.time },
        rsiPoint1: { index: first.index, value: first.rsi, time: first.time },
        rsiPoint2: { index: last.index, value: last.rsi, time: last.time },
        strength,
        touches,
    };
}

function findDivergenceRuns(
    candles: Candle[],
    rsi: number[],
    type: RsiDivergence['type'],
    options: Required<TripleDivergenceOptions>
): RsiDivergence[] {
    const bullish = type === 'BULLISH';
    const prices = candles.map((candle) => (bullish ? candle.low : candle.high));
    const touches: DivergenceTouch[] = findSwings(prices, options.pivotBars, bullish ? 'low' : 'high')
        .map((index) => ({ index, time: candles[index].time, price: prices[index], rsi: rsiNearSwing(rsi, index, bullish) }))
        .filter((touch) => Number.isFinite(touch.rsi));

    // Price must keep making lower lows (higher highs) while RSI holds within
    // the tolerance of both the previous touch and the first one.
    const rsiHolds = (from: DivergenceTouch, to: DivergenceTouch) => bullish
        ? to.rsi >= from.rsi - options.rsiTolerance
        : to.rsi <= from.rsi + options.rsiTolerance;
    const priceExtends = (from: DivergenceTouch, to: DivergenceTouch) => bullish
        ? to.price < from.price
        : to.price > from.price;

    const results: RsiDivergence[] = [];
    let run: DivergenceTouch[] = [];
    const flush = () => {
        if (run.length < options.minTouches) return;
        const divergence = toDivergence(type, run, candles, options.minMoveRanges);
        if (divergence) results.push(divergence);
    };

    for (const touch of touches) {
        const previous = run[run.length - 1];
        const step = previous !== undefined &&
            touch.index - previous.index <= options.maxGapBars &&
            priceExtends(previous, touch) &&
            rsiHolds(previous, touch);

        if (step && rsiHolds(run[0], touch)) {
            run.push(touch);
            continue;
        }

        flush();
        // A step that only drifted too far from the first touch can still
        // start the next pattern from the previous touch.
        run = step ? [previous, touch] : [touch];
    }
    flush();

    return results;
}

/**
 * Walid's divergence: three (or more) touches where price keeps making lower
 * lows while RSI stays at the same level or only a little lower — sellers are
 * pushing price down without the momentum to back it. Mirror for tops: higher
 * highs while RSI stays level or only a little higher.
 *
 * `rsi` must be aligned with `candles`. Returned oldest first.
 */
export function findTripleDivergences(
    candles: Candle[],
    rsi: number[],
    options: TripleDivergenceOptions = {}
): RsiDivergence[] {
    const resolved = { ...TRIPLE_DIVERGENCE_DEFAULTS, ...options };
    return [
        ...findDivergenceRuns(candles, rsi, 'BULLISH', resolved),
        ...findDivergenceRuns(candles, rsi, 'BEARISH', resolved),
    ].sort((first, second) => first.pricePoint2.index - second.pricePoint2.index);
}

function latestDivergence(
    candles: Candle[],
    rsi: number[],
    type: RsiDivergence['type'],
    lookbackBars: number
): RsiDivergence | null {
    const recent = findTripleDivergences(candles, rsi).filter((divergence) =>
        divergence.type === type && divergence.pricePoint2.index >= candles.length - 1 - lookbackBars
    );
    return recent[recent.length - 1] ?? null;
}

/**
 * Latest bullish three-touch divergence whose last touch is within
 * `lookbackBars` of the final candle.
 */
export function detectBullishDivergence(
    candles: Candle[],
    rsi: number[],
    lookbackBars: number = 40
): RsiDivergence | null {
    return latestDivergence(candles, rsi, 'BULLISH', lookbackBars);
}

/**
 * Latest bearish three-touch divergence whose last touch is within
 * `lookbackBars` of the final candle.
 */
export function detectBearishDivergence(
    candles: Candle[],
    rsi: number[],
    lookbackBars: number = 40
): RsiDivergence | null {
    return latestDivergence(candles, rsi, 'BEARISH', lookbackBars);
}

/**
 * Check for any divergence (bullish or bearish)
 */
export function detectDivergence(
    candles: Candle[],
    rsiPeriod: number = 14,
    lookbackBars: number = 40
): RsiDivergence | null {
    const closes = candles.map(c => c.close);
    const rsi = calculateRSI(closes, rsiPeriod);

    // Check for bullish divergence first (typically more reliable at supports)
    const bullish = detectBullishDivergence(candles, rsi, lookbackBars);
    if (bullish) return bullish;

    // Check for bearish divergence
    const bearish = detectBearishDivergence(candles, rsi, lookbackBars);
    if (bearish) return bearish;

    return null;
}
