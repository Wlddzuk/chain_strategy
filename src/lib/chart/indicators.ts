import {
    advanceRsiAccumulator,
    buildRsiAccumulator,
    calculateRSI,
    createRsiAccumulator,
    type RsiAccumulatorState,
} from '@/lib/trading/rsi-divergence';
import type { Candle } from '@/lib/trading/types';

export const RSI_PERIOD = 14;
export const BOLLINGER_PERIOD = 20;
export const BOLLINGER_MULTIPLIER = 2;

export type IndicatorSource = Pick<Candle, 'time' | 'close'>;

export interface IndicatorPoint {
    time: number;
    value: number;
}

export interface RsiIncrementalState {
    period: number;
    /** RSI state through the candle immediately before `formingTime`. */
    previousClosedState: RsiAccumulatorState;
    formingTime: number | null;
    formingClose: number | null;
    /** Candidate state including the latest value of the forming candle. */
    formingState: RsiAccumulatorState | null;
}

export interface RsiSeriesResult {
    points: IndicatorPoint[];
    state: RsiIncrementalState;
}

export interface RsiIncrementalResult {
    point: IndicatorPoint | null;
    state: RsiIncrementalState;
}

export interface BollingerBandPoint {
    time: number;
    upper: number;
    middle: number;
    lower: number;
}

function assertPositiveInteger(value: number, name: string): void {
    if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(`${name} must be a positive integer`);
    }
}

function assertValidMultiplier(multiplier: number): void {
    if (!Number.isFinite(multiplier) || multiplier < 0) {
        throw new RangeError('Bollinger multiplier must be a non-negative finite number');
    }
}

function toRsiPoint(time: number, value: number): IndicatorPoint | null {
    return Number.isFinite(value) ? { time, value } : null;
}

/**
 * Calculate the complete RSI series and seed an incremental cursor. The latest
 * source candle is deliberately modeled as forming, so repeated updates for its
 * timestamp always start from the prior closed candle's Wilder averages.
 */
export function calculateRsiSeries(
    sources: readonly IndicatorSource[],
    period: number = RSI_PERIOD
): RsiSeriesResult {
    assertPositiveInteger(period, 'RSI period');

    const closes = sources.map((source) => source.close);
    const values = calculateRSI(closes, period);
    const points = sources.flatMap((source, index) => {
        const point = toRsiPoint(source.time, values[index]);
        return point ? [point] : [];
    });

    const formingSource = sources.at(-1);
    if (!formingSource) {
        return {
            points,
            state: {
                period,
                previousClosedState: createRsiAccumulator(period),
                formingTime: null,
                formingClose: null,
                formingState: null,
            },
        };
    }

    const previousClosedState = buildRsiAccumulator(closes.slice(0, -1), period);
    const formingStep = advanceRsiAccumulator(previousClosedState, formingSource.close);

    return {
        points,
        state: {
            period,
            previousClosedState,
            formingTime: formingSource.time,
            formingClose: formingSource.close,
            formingState: formingStep.state,
        },
    };
}

/**
 * Recalculate only the latest RSI point. A same-time update is a forming-candle
 * replacement; a later timestamp closes the previous candle and advances once.
 */
export function updateRsiLastPoint(
    state: RsiIncrementalState,
    source: IndicatorSource
): RsiIncrementalResult {
    if (state.formingTime !== null && source.time < state.formingTime) {
        throw new RangeError('Incremental RSI updates must be time ordered');
    }

    const isNewCandle = state.formingTime !== null && source.time > state.formingTime;
    const previousClosedState = isNewCandle
        ? (state.formingState ?? state.previousClosedState)
        : state.previousClosedState;
    const formingStep = advanceRsiAccumulator(previousClosedState, source.close);

    return {
        point: toRsiPoint(source.time, formingStep.value),
        state: {
            period: state.period,
            previousClosedState,
            formingTime: source.time,
            formingClose: source.close,
            formingState: formingStep.state,
        },
    };
}

function calculateBollingerWindow(
    sources: readonly IndicatorSource[],
    period: number,
    multiplier: number,
    endIndex: number
): BollingerBandPoint {
    const startIndex = endIndex - period + 1;
    let sum = 0;
    for (let index = startIndex; index <= endIndex; index++) {
        sum += sources[index].close;
    }

    const middle = sum / period;
    let squaredDeviationSum = 0;
    for (let index = startIndex; index <= endIndex; index++) {
        const deviation = sources[index].close - middle;
        squaredDeviationSum += deviation * deviation;
    }

    const standardDeviation = Math.sqrt(squaredDeviationSum / period);
    const distance = standardDeviation * multiplier;

    return {
        time: sources[endIndex].time,
        upper: middle + distance,
        middle,
        lower: middle - distance,
    };
}

/** Standard 20-period, two-population-standard-deviation Bollinger Bands. */
export function calculateBollingerBands(
    sources: readonly IndicatorSource[],
    period: number = BOLLINGER_PERIOD,
    multiplier: number = BOLLINGER_MULTIPLIER
): BollingerBandPoint[] {
    assertPositiveInteger(period, 'Bollinger period');
    assertValidMultiplier(multiplier);
    if (sources.length < period) return [];

    const result: BollingerBandPoint[] = [];
    for (let endIndex = period - 1; endIndex < sources.length; endIndex++) {
        result.push(calculateBollingerWindow(sources, period, multiplier, endIndex));
    }
    return result;
}

/** Calculate one display point from only the latest trailing Bollinger window. */
export function calculateBollingerLastPoint(
    sources: readonly IndicatorSource[],
    period: number = BOLLINGER_PERIOD,
    multiplier: number = BOLLINGER_MULTIPLIER
): BollingerBandPoint | null {
    assertPositiveInteger(period, 'Bollinger period');
    assertValidMultiplier(multiplier);
    if (sources.length < period) return null;

    return calculateBollingerWindow(sources, period, multiplier, sources.length - 1);
}
