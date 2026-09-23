import { describe, expect, it } from 'vitest';
import { calculateRSI } from '@/lib/trading/rsi-divergence';
import {
    BOLLINGER_MULTIPLIER,
    BOLLINGER_PERIOD,
    RSI_PERIOD,
    calculateBollingerBands,
    calculateBollingerLastPoint,
    calculateRsiSeries,
    updateRsiLastPoint,
    type IndicatorSource,
} from './indicators';

const MINUTE = 60_000;
const START = Date.UTC(2026, 6, 14, 12, 0, 0);

function point(index: number, close: number): IndicatorSource {
    return { time: START + (index * MINUTE), close };
}

function expectLatestRsiToMatchFullRecompute(
    sources: IndicatorSource[],
    actual: number | undefined
): void {
    const expected = calculateRSI(sources.map((source) => source.close), RSI_PERIOD).at(-1);
    expect(expected).toBeTypeOf('number');
    expect(Number.isFinite(expected)).toBe(true);
    expect(actual).toBeCloseTo(expected as number, 12);
}

describe('RSI chart series', () => {
    const closes = [
        100, 102, 101, 104, 103, 106, 105, 107, 104, 108,
        109, 107, 111, 110, 114, 112, 115, 113, 117, 116,
        119, 118, 121, 117, 122, 120, 124, 123, 126, 122,
    ];

    it('uses the strategy RSI values for its complete display series', () => {
        const sources = closes.map((close, index) => point(index, close));
        const expected = calculateRSI(closes, RSI_PERIOD);
        const result = calculateRsiSeries(sources);

        expect(result.points).toHaveLength(closes.length - RSI_PERIOD);
        result.points.forEach((actual, resultIndex) => {
            const sourceIndex = resultIndex + RSI_PERIOD;
            expect(actual.time).toBe(sources[sourceIndex].time);
            expect(actual.value).toBeCloseTo(expected[sourceIndex], 12);
        });
    });

    it('matches a full recompute across repeated forming updates and new bars', () => {
        let sources = closes.slice(0, 22).map((close, index) => point(index, close));
        let state = calculateRsiSeries(sources).state;

        for (const formingClose of [123.5, 116.25, 121.75]) {
            const updated = { ...sources.at(-1) as IndicatorSource, close: formingClose };
            sources = [...sources.slice(0, -1), updated];
            const result = updateRsiLastPoint(state, updated);
            state = result.state;
            expectLatestRsiToMatchFullRecompute(sources, result.point?.value);
        }

        for (let index = sources.length; index < closes.length; index++) {
            const appended = point(index, closes[index]);
            sources = [...sources, appended];
            let result = updateRsiLastPoint(state, appended);
            state = result.state;
            expectLatestRsiToMatchFullRecompute(sources, result.point?.value);

            const revised = { ...appended, close: appended.close + ((index % 3) - 1) * 0.37 };
            sources = [...sources.slice(0, -1), revised];
            result = updateRsiLastPoint(state, revised);
            state = result.state;
            expectLatestRsiToMatchFullRecompute(sources, result.point?.value);
        }
    });

    it('returns no display point before the RSI seed period and rejects old bars', () => {
        const sources = closes.slice(0, 5).map((close, index) => point(index, close));
        const seeded = calculateRsiSeries(sources);

        expect(seeded.points).toEqual([]);
        expect(() => updateRsiLastPoint(seeded.state, point(3, 99))).toThrow(/time ordered/);
    });
});

describe('Bollinger Bands chart series', () => {
    it('calculates the standard population-deviation bands', () => {
        const sources = Array.from({ length: BOLLINGER_PERIOD }, (_, index) => point(index, index + 1));
        const result = calculateBollingerBands(sources);

        expect(result).toHaveLength(1);
        expect(result[0].middle).toBeCloseTo(10.5, 12);
        expect(result[0].upper).toBeCloseTo(10.5 + (Math.sqrt(33.25) * BOLLINGER_MULTIPLIER), 12);
        expect(result[0].lower).toBeCloseTo(10.5 - (Math.sqrt(33.25) * BOLLINGER_MULTIPLIER), 12);
    });

    it('makes the trailing-window last point match a complete recompute', () => {
        let sources = Array.from(
            { length: 35 },
            (_, index) => point(index, 100 + (index * 0.7) + Math.sin(index / 2) * 3)
        );

        for (const formingClose of [127.4, 119.25, 132.05]) {
            sources = [
                ...sources.slice(0, -1),
                { ...sources.at(-1) as IndicatorSource, close: formingClose },
            ];
            const expected = calculateBollingerBands(sources).at(-1);
            const actual = calculateBollingerLastPoint(sources);

            expect(actual).not.toBeNull();
            expect(actual?.time).toBe(expected?.time);
            expect(actual?.upper).toBeCloseTo(expected?.upper as number, 12);
            expect(actual?.middle).toBeCloseTo(expected?.middle as number, 12);
            expect(actual?.lower).toBeCloseTo(expected?.lower as number, 12);
        }
    });

    it('returns no bands until a complete trailing window exists', () => {
        const sources = Array.from({ length: BOLLINGER_PERIOD - 1 }, (_, index) => point(index, 100));

        expect(calculateBollingerBands(sources)).toEqual([]);
        expect(calculateBollingerLastPoint(sources)).toBeNull();
    });
});
