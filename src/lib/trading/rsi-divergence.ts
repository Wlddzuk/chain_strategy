// RSI Calculation and Divergence Detection Module
// Implements RSI calculation and bullish/bearish divergence detection for signal confirmation

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

/**
 * Find local highs in price data
 */
function findLocalHighs(
    values: number[],
    lookback: number = 5
): Array<{ index: number; value: number }> {
    const highs: Array<{ index: number; value: number }> = [];

    for (let i = lookback; i < values.length - lookback; i++) {
        let isHigh = true;
        for (let j = i - lookback; j <= i + lookback; j++) {
            if (j !== i && values[j] >= values[i]) {
                isHigh = false;
                break;
            }
        }
        if (isHigh && !isNaN(values[i])) {
            highs.push({ index: i, value: values[i] });
        }
    }

    return highs;
}

/**
 * Find local lows in price data
 */
function findLocalLows(
    values: number[],
    lookback: number = 5
): Array<{ index: number; value: number }> {
    const lows: Array<{ index: number; value: number }> = [];

    for (let i = lookback; i < values.length - lookback; i++) {
        let isLow = true;
        for (let j = i - lookback; j <= i + lookback; j++) {
            if (j !== i && values[j] <= values[i]) {
                isLow = false;
                break;
            }
        }
        if (isLow && !isNaN(values[i])) {
            lows.push({ index: i, value: values[i] });
        }
    }

    return lows;
}

/**
 * Detect Bullish Divergence
 * Price makes Lower Low (LL) while RSI makes Higher Low (HL)
 * Indicates potential bullish reversal
 */
export function detectBullishDivergence(
    candles: Candle[],
    rsi: number[],
    lookbackBars: number = 20
): RsiDivergence | null {
    const startIdx = Math.max(0, candles.length - lookbackBars);
    const prices = candles.slice(startIdx).map(c => c.low);
    const rsiSlice = rsi.slice(startIdx);

    const priceLows = findLocalLows(prices, 3);
    const rsiLows = findLocalLows(rsiSlice, 3);

    if (priceLows.length < 2 || rsiLows.length < 2) {
        return null;
    }

    // Compare recent lows
    const recentPriceLows = priceLows.slice(-2);
    const recentRsiLows = rsiLows.slice(-2);

    const priceLow1 = recentPriceLows[0];
    const priceLow2 = recentPriceLows[1];
    const rsiLow1 = recentRsiLows[0];
    const rsiLow2 = recentRsiLows[1];

    // Bullish divergence: Price LL, RSI HL
    if (priceLow2.value < priceLow1.value && rsiLow2.value > rsiLow1.value) {
        const strength = Math.min(100, Math.abs(rsiLow2.value - rsiLow1.value) * 2);
        const priceIndex1 = priceLow1.index + startIdx;
        const priceIndex2 = priceLow2.index + startIdx;
        const rsiIndex1 = rsiLow1.index + startIdx;
        const rsiIndex2 = rsiLow2.index + startIdx;

        return {
            type: 'BULLISH',
            pricePoint1: { index: priceIndex1, value: priceLow1.value, time: candles[priceIndex1]?.time },
            pricePoint2: { index: priceIndex2, value: priceLow2.value, time: candles[priceIndex2]?.time },
            rsiPoint1: { index: rsiIndex1, value: rsiLow1.value, time: candles[rsiIndex1]?.time },
            rsiPoint2: { index: rsiIndex2, value: rsiLow2.value, time: candles[rsiIndex2]?.time },
            strength,
        };
    }

    return null;
}

/**
 * Detect Bearish Divergence
 * Price makes Higher High (HH) while RSI makes Lower High (LH)
 * Indicates potential bearish reversal
 */
export function detectBearishDivergence(
    candles: Candle[],
    rsi: number[],
    lookbackBars: number = 20
): RsiDivergence | null {
    const startIdx = Math.max(0, candles.length - lookbackBars);
    const prices = candles.slice(startIdx).map(c => c.high);
    const rsiSlice = rsi.slice(startIdx);

    const priceHighs = findLocalHighs(prices, 3);
    const rsiHighs = findLocalHighs(rsiSlice, 3);

    if (priceHighs.length < 2 || rsiHighs.length < 2) {
        return null;
    }

    // Compare recent highs
    const recentPriceHighs = priceHighs.slice(-2);
    const recentRsiHighs = rsiHighs.slice(-2);

    const priceHigh1 = recentPriceHighs[0];
    const priceHigh2 = recentPriceHighs[1];
    const rsiHigh1 = recentRsiHighs[0];
    const rsiHigh2 = recentRsiHighs[1];

    // Bearish divergence: Price HH, RSI LH
    if (priceHigh2.value > priceHigh1.value && rsiHigh2.value < rsiHigh1.value) {
        const strength = Math.min(100, Math.abs(rsiHigh1.value - rsiHigh2.value) * 2);
        const priceIndex1 = priceHigh1.index + startIdx;
        const priceIndex2 = priceHigh2.index + startIdx;
        const rsiIndex1 = rsiHigh1.index + startIdx;
        const rsiIndex2 = rsiHigh2.index + startIdx;

        return {
            type: 'BEARISH',
            pricePoint1: { index: priceIndex1, value: priceHigh1.value, time: candles[priceIndex1]?.time },
            pricePoint2: { index: priceIndex2, value: priceHigh2.value, time: candles[priceIndex2]?.time },
            rsiPoint1: { index: rsiIndex1, value: rsiHigh1.value, time: candles[rsiIndex1]?.time },
            rsiPoint2: { index: rsiIndex2, value: rsiHigh2.value, time: candles[rsiIndex2]?.time },
            strength,
        };
    }

    return null;
}

/**
 * Check for any divergence (bullish or bearish)
 */
export function detectDivergence(
    candles: Candle[],
    rsiPeriod: number = 14,
    lookbackBars: number = 20
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
