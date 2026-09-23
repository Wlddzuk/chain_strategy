import { describe, expect, it } from 'vitest';
import type { ChainSignal } from '@/lib/trading/types';
import {
    calculateNetRiskReward,
    isPositionSizingUnsafe,
    sortActiveSignalsByActionability,
} from './trade-metrics';

function signal(
    id: string,
    coin: string,
    entryPrice: number,
    createdAt: number,
    status: ChainSignal['status'] = 'PENDING'
): ChainSignal {
    return {
        id,
        coin,
        timeframe: '1h',
        phase: 'ENTRY',
        direction: 'LONG',
        eventZone: {} as ChainSignal['eventZone'],
        originZone: {} as ChainSignal['originZone'],
        entryPrice,
        stopLoss: entryPrice * 0.99,
        takeProfit: entryPrice * 1.03,
        riskRewardRatio: 3,
        confidence: 80,
        hasRsiDivergence: false,
        createdAt,
        expiresAt: createdAt + 3_600_000,
        status,
    };
}

describe('calculateNetRiskReward', () => {
    it('adds round-trip fees to risk and subtracts them from reward', () => {
        const result = calculateNetRiskReward(100, 99, 104, 0.05);

        expect(result.netRiskPercent).toBeCloseTo(1.1);
        expect(result.netRewardPercent).toBeCloseTo(3.9);
        expect(result.ratio).toBeCloseTo(3.9 / 1.1);
    });

    it('returns zero instead of a negative or non-finite ratio', () => {
        expect(calculateNetRiskReward(100, 99, 100.05, 0.05)).toEqual({
            netRiskPercent: 1.1,
            netRewardPercent: 0,
            ratio: 0,
        });
        expect(calculateNetRiskReward(0, 0, 0, 0.05)).toEqual({
            netRiskPercent: 0,
            netRewardPercent: 0,
            ratio: 0,
        });
    });
});

describe('isPositionSizingUnsafe', () => {
    it('flags notional or margin that exceeds either safety limit', () => {
        expect(isPositionSizingUnsafe({ notionalValue: 100_001, marginRequired: 1 }, 10_000, 10)).toBe(true);
        expect(isPositionSizingUnsafe({ notionalValue: 50_000, marginRequired: 5_001 }, 10_000, 10)).toBe(true);
    });

    it('allows values exactly at the configured limits', () => {
        expect(isPositionSizingUnsafe({
            notionalValue: 100_000,
            marginRequired: 5_000,
        }, 10_000, 10)).toBe(false);
    });
});

describe('signal actionability', () => {
    it('ranks TOUCHED first, then near entries, then distance, with newest ties first', () => {
        const candidates = [
            signal('far', 'FAR', 100, 500),
            signal('near-old', 'NEAR', 100, 100),
            signal('same-distance-old', 'TIE', 100, 200),
            signal('same-distance-new', 'TIE', 100, 300),
            signal('touched', 'TOUCHED', 100, 50, 'TOUCHED'),
            signal('middle', 'MIDDLE', 100, 400),
        ];
        const originalOrder = candidates.map((candidate) => candidate.id);
        const prices = {
            FAR: 105,
            NEAR: 100.2,
            TIE: 102,
            TOUCHED: 150,
            MIDDLE: 101,
        };

        const sorted = sortActiveSignalsByActionability(candidates, prices, 0.25);

        expect(sorted.map((candidate) => candidate.id)).toEqual([
            'touched',
            'near-old',
            'middle',
            'same-distance-new',
            'same-distance-old',
            'far',
        ]);
        expect(candidates.map((candidate) => candidate.id)).toEqual(originalOrder);
    });
});
