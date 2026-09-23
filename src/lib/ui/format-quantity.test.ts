import { describe, expect, it } from 'vitest';
import {
    getQuantityDecimalPlaces,
    getRoundedQuantity,
} from './format-quantity';

describe('getRoundedQuantity', () => {
    it('floors to Hyperliquid szDecimals and never rounds the plan up', () => {
        expect(getRoundedQuantity(12.349, 2)).toMatchObject({
            roundedValue: 12.34,
            displayValue: '12.34',
            decimalPlaces: 2,
        });
        expect(getRoundedQuantity(0.299, 2).roundedValue).toBe(0.29);
        expect(getRoundedQuantity(189_307.173606, 0)).toMatchObject({
            roundedValue: 189_307,
            displayValue: '189307',
            decimalPlaces: 0,
        });
        expect(getRoundedQuantity(12.99, 0).displayValue).toBe('12');
    });

    it('uses whole units, two decimals, and four significant digits as fallbacks', () => {
        expect(getRoundedQuantity(189_307.173606)).toMatchObject({
            displayValue: '189307',
            decimalPlaces: 0,
        });
        expect(getRoundedQuantity(12.349)).toMatchObject({
            displayValue: '12.34',
            decimalPlaces: 2,
        });
        expect(getRoundedQuantity(0.123456)).toMatchObject({
            displayValue: '0.1234',
            decimalPlaces: 4,
        });
        expect(getRoundedQuantity(0.00123456)).toMatchObject({
            displayValue: '0.001234',
            decimalPlaces: 6,
        });
        expect(getQuantityDecimalPlaces(0.000099999)).toBe(8);
    });

    it('uses the exact same raw string for display and clipboard input', () => {
        const quantity = getRoundedQuantity(7.899999, 3);

        expect(quantity.displayValue).toBe('7.899');
        expect(quantity.copyValue).toBe(quantity.displayValue);
        expect(quantity.copyValue).not.toContain(',');
    });

    it('returns a safe zero for invalid or non-positive position sizes', () => {
        expect(getRoundedQuantity(Number.NaN, 4).displayValue).toBe('0');
        expect(getRoundedQuantity(-2, 4).displayValue).toBe('0');
    });
});
