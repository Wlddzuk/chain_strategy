import { describe, expect, it } from 'vitest';
import { formatCandleCountdown, getMillisecondsUntilCandleClose } from './candle-countdown';

const FIVE_MINUTES = 5 * 60 * 1000;
const BOUNDARY = Date.UTC(2026, 6, 15, 12, 0, 0);

describe('candle close countdown', () => {
    it('returns a full period exactly when a new candle opens', () => {
        expect(BOUNDARY % FIVE_MINUTES).toBe(0);
        expect(getMillisecondsUntilCandleClose(BOUNDARY, '5m')).toBe(FIVE_MINUTES);
    });

    it('counts to the next aligned boundary from wall-clock time', () => {
        expect(getMillisecondsUntilCandleClose(BOUNDARY + 1, '5m')).toBe(FIVE_MINUTES - 1);
        expect(getMillisecondsUntilCandleClose(BOUNDARY + FIVE_MINUTES - 1, '5m')).toBe(1);
    });

    it('formats total minutes and seconds, including multi-hour candles', () => {
        expect(formatCandleCountdown((23 * 60 + 14) * 1000)).toBe('23:14');
        expect(formatCandleCountdown(4 * 60 * 60 * 1000)).toBe('240:00');
        expect(formatCandleCountdown(1)).toBe('00:01');
    });
});
