import { describe, expect, it } from 'vitest';
import { calculatePositionSize, calculateRiskReward, validateTradeParams } from './risk-calculator';

describe('risk calculator', () => {
    it.each(['equity', 'riskPercent', 'leverage', 'entryPrice', 'stopLoss'] as const)(
        'rejects non-finite %s without producing non-finite sizing', (field) => {
            for (const value of [NaN, Infinity, -Infinity]) {
                const params = { equity: 10000, riskPercent: 1, leverage: 10, entryPrice: 100, stopLoss: 98, [field]: value };
                expect(validateTradeParams(params).length).toBeGreaterThan(0);
                expect(Object.values(calculatePositionSize(params)).every(Number.isFinite)).toBe(true);
            }
        }
    );

    it('enforces the same risk and leverage limits as Settings and the trade ticket', () => {
        const params = { equity: 10000, riskPercent: 1, leverage: 10, entryPrice: 100, stopLoss: 98 };
        expect(validateTradeParams({ ...params, riskPercent: 50 }).length).toBeGreaterThan(0);
        expect(validateTradeParams({ ...params, leverage: 75 }).length).toBeGreaterThan(0);
    });
    it('caps dollar loss at the configured account risk', () => {
        const result = calculatePositionSize({
            equity: 10000,
            riskPercent: 1,
            leverage: 10,
            entryPrice: 100,
            stopLoss: 99.5,
        });

        expect(result.riskAmount).toBeCloseTo(100);
        expect(result.stopDistancePercent).toBeCloseTo(0.005);
        expect(result.notionalValue).toBeCloseTo(20000);
        expect(result.positionSize).toBeCloseTo(200);
        expect(result.marginRequired).toBeCloseTo(2000);
        expect(result.positionSize * Math.abs(100 - 99.5)).toBeCloseTo(100);
    });

    it('uses leverage for collateral without multiplying planned risk', () => {
        const unlevered = calculatePositionSize({
            equity: 10000,
            riskPercent: 1,
            leverage: 1,
            entryPrice: 100,
            stopLoss: 99.5,
        });
        const leveraged = calculatePositionSize({
            equity: 10000,
            riskPercent: 1,
            leverage: 20,
            entryPrice: 100,
            stopLoss: 99.5,
        });

        expect(leveraged.notionalValue).toBeCloseTo(unlevered.notionalValue);
        expect(leveraged.riskAmount).toBeCloseTo(unlevered.riskAmount);
        expect(leveraged.marginRequired).toBeCloseTo(unlevered.marginRequired / 20);
    });

    it('calculates risk-to-reward for long and short levels', () => {
        expect(calculateRiskReward(100, 98, 106)).toBe(3);
        expect(calculateRiskReward(100, 102, 94)).toBe(3);
    });
});
