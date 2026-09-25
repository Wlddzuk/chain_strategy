import { describe, expect, it } from 'vitest';
import { detectEngulfingPatterns, isDecisiveEngulfing } from './pattern-detector';
import { createZoneFromEngulfing } from './zone-marker';
import { Candle } from './types';

const HOUR = 60 * 60 * 1000;

function bar(index: number, open: number, high: number, low: number, close: number): Candle {
    return { time: index * HOUR, open, high, low, close, volume: 1 };
}

/** Small alternating candles with bodies of 0.4. */
function chop(count: number): Candle[] {
    return Array.from({ length: count }, (_, index) => index % 2 === 0
        ? bar(index, 100, 100.5, 99.5, 100.4)
        : bar(index, 100.4, 100.6, 99.8, 100));
}

describe('engulfing structures', () => {
    it('zones a bullish engulfing on the red candle it swallowed, down to the lowest wick', () => {
        const red = bar(20, 101, 101.2, 99.6, 100);
        const green = bar(21, 99.9, 102.5, 99.3, 102.2);
        const candles = [...chop(20), red, green];
        const pattern = detectEngulfingPatterns(candles).find((item) => item.index === 21);

        expect(pattern?.type).toBe('BULLISH');
        expect(pattern?.engulfedCandle).toBe(red);
        const zone = createZoneFromEngulfing(pattern!);
        expect(zone).toMatchObject({ type: 'DEMAND', createdAt: red.time, proximalLine: 101, distalLine: 99.3 });
    });

    it('zones a bearish engulfing on the green candle it swallowed, up to the highest wick', () => {
        const green = bar(20, 100, 101.4, 99.8, 101);
        const red = bar(21, 101.1, 101.7, 98.5, 98.8);
        const candles = [...chop(20), green, red];
        const pattern = detectEngulfingPatterns(candles).find((item) => item.index === 21);

        expect(pattern?.type).toBe('BEARISH');
        expect(pattern?.engulfedCandle).toBe(green);
        expect(createZoneFromEngulfing(pattern!)).toMatchObject({ type: 'SUPPLY', createdAt: green.time, proximalLine: 100, distalLine: 101.7 });
    });

    it('counts only a visibly bigger engulfing body as decisive', () => {
        const decisive = [...chop(20), bar(20, 101, 101.2, 99.6, 100), bar(21, 99.9, 102.5, 99.3, 102.2)];
        const [big] = detectEngulfingPatterns(decisive).filter((item) => item.index === 21);
        expect(isDecisiveEngulfing(decisive, big)).toBe(true);

        // Engulfs, but only just — a 0.45 body over a 0.4 body in 0.4-body chop.
        const marginal = [...chop(20), bar(20, 100.4, 100.5, 99.9, 100), bar(21, 99.98, 100.6, 99.9, 100.43)];
        const [small] = detectEngulfingPatterns(marginal).filter((item) => item.index === 21);
        expect(small).toBeDefined();
        expect(isDecisiveEngulfing(marginal, small)).toBe(false);
    });
});
