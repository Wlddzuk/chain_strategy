import { describe, expect, it } from 'vitest';
import { formatPrice } from './format-price';

describe('formatPrice', () => {
    it('uses two decimal places for prices at or above $10', () => {
        expect(formatPrice(10)).toBe('10.00');
        expect(formatPrice(1_234.567)).toBe('1,234.57');
    });

    it('uses four decimal places from $0.10 up to $10', () => {
        expect(formatPrice(0.1)).toBe('0.1000');
        expect(formatPrice(9.87654)).toBe('9.8765');
    });

    it('keeps DOGE-scale entry and stop prices distinguishable', () => {
        const entry = formatPrice(0.07543);
        const stop = formatPrice(0.07481);

        expect(entry).toBe('0.07543');
        expect(stop).toBe('0.07481');
        expect(entry).not.toBe(stop);
    });

    it('limits smaller prices to five significant digits', () => {
        expect(formatPrice(0.0000123456)).toBe('0.000012346');
    });
});
