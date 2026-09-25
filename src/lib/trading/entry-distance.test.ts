import { describe, expect, it } from 'vitest';
import { getMoveToEntryPercent } from './entry-distance';

describe('getMoveToEntryPercent', () => {
    it('measures the signed move from current price to entry', () => {
        expect(getMoveToEntryPercent(105, 100)).toBeCloseTo(-4.76190476);
        expect(getMoveToEntryPercent(95, 100)).toBeCloseTo(5.26315789);
        expect(getMoveToEntryPercent(100, 100)).toBe(0);
    });

    it('returns an unusable distance for invalid prices', () => {
        expect(getMoveToEntryPercent(0, 100)).toBe(Number.POSITIVE_INFINITY);
        expect(getMoveToEntryPercent(Number.NaN, 100)).toBe(Number.POSITIVE_INFINITY);
        expect(getMoveToEntryPercent(100, 0)).toBe(Number.POSITIVE_INFINITY);
    });
});
