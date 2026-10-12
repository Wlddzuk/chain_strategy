import { describe, expect, it } from 'vitest';
import { formatCompactUsd, getFundingImpact } from './market-context';

const long = { direction: 'LONG' as const, entryPrice: 100, stopLoss: 99 };
const short = { direction: 'SHORT' as const, entryPrice: 100, stopLoss: 101 };

describe('getFundingImpact', () => {
    it('charges longs and pays shorts when funding is positive', () => {
        // 0.00125% an hour is 0.03% a day, which is 0.03R on a 1% stop.
        expect(getFundingImpact(long, 0.00125)).toEqual({
            pays: true,
            dailyPercent: expect.closeTo(0.03),
            dailyR: expect.closeTo(0.03),
        });
        expect(getFundingImpact(short, 0.00125)?.pays).toBe(false);
    });

    it('flips when funding is negative and nobody pays at zero', () => {
        expect(getFundingImpact(long, -0.002)?.pays).toBe(false);
        expect(getFundingImpact(short, -0.002)?.pays).toBe(true);
        expect(getFundingImpact(long, 0)).toMatchObject({ pays: false, dailyR: 0 });
    });

    it('returns null without a usable stop or rate', () => {
        expect(getFundingImpact({ ...long, stopLoss: 100 }, 0.001)).toBeNull();
        expect(getFundingImpact(long, Number.NaN)).toBeNull();
    });
});

describe('formatCompactUsd', () => {
    it('shortens thousands, millions, and billions', () => {
        expect(formatCompactUsd(1_234_000_000)).toBe('$1.2B');
        expect(formatCompactUsd(412_400_000)).toBe('$412M');
        expect(formatCompactUsd(85_300)).toBe('$85K');
        expect(formatCompactUsd(Number.NaN)).toBe('—');
    });
});
