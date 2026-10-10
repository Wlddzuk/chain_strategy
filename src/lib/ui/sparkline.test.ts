import { describe, expect, it } from 'vitest';
import { buildSparklinePath } from './sparkline';

describe('buildSparklinePath', () => {
    it('scales values across the box with the highest value at the top', () => {
        expect(buildSparklinePath([1, 3, 2], 100, 20)).toBe('M0.0 20.0 L50.0 0.0 L100.0 10.0');
    });

    it('draws a flat series on the midline', () => {
        expect(buildSparklinePath([5, 5], 10, 20)).toBe('M0.0 10.0 L10.0 10.0');
    });

    it('returns null without two finite values', () => {
        expect(buildSparklinePath([], 100, 20)).toBeNull();
        expect(buildSparklinePath([1, Number.NaN], 100, 20)).toBeNull();
    });
});
