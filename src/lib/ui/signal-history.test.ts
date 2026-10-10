import { describe, expect, it } from 'vitest';
import type { ChainSignal } from '@/lib/trading/types';
import { getHistoryCategory, getHistoryNetR } from './signal-history';

const fees = { makerFeePercent: 0.015, takerFeePercent: 0.045 };

function signal(overrides: Partial<ChainSignal>): ChainSignal {
    return {
        id: 'signal',
        coin: 'BTC',
        timeframe: '1h',
        phase: 'ENTRY',
        direction: 'LONG',
        eventZone: {} as ChainSignal['eventZone'],
        originZone: {} as ChainSignal['originZone'],
        entryPrice: 100,
        stopLoss: 99,
        takeProfit: 103,
        riskRewardRatio: 3,
        confidence: 80,
        hasRsiDivergence: false,
        createdAt: 0,
        expiresAt: 1,
        status: 'TOUCHED',
        ...overrides,
    };
}

describe('getHistoryCategory', () => {
    it('sorts plans into won, lost, missed, and other', () => {
        expect(getHistoryCategory(signal({ outcome: 'WIN' }))).toBe('won');
        expect(getHistoryCategory(signal({ status: 'FILLED', outcome: 'LOSS' }))).toBe('lost');
        expect(getHistoryCategory(signal({ status: 'MISSED' }))).toBe('missed');
        expect(getHistoryCategory(signal({ status: 'INVALIDATED' }))).toBe('other');
        expect(getHistoryCategory(signal({ status: 'CANCELLED' }))).toBe('other');
    });
});

describe('getHistoryNetR', () => {
    it('subtracts maker + maker fees from a win and maker + taker from a loss', () => {
        // 1% stop: a win pays 0.03% = 0.03R, a loss pays 0.06% = 0.06R.
        expect(getHistoryNetR(signal({ outcome: 'WIN' }), fees)).toBeCloseTo(2.97);
        expect(getHistoryNetR(signal({ outcome: 'LOSS' }), fees)).toBeCloseTo(-1.06);
    });

    it('has no R for plans that never resolved', () => {
        expect(getHistoryNetR(signal({ status: 'MISSED' }), fees)).toBeNull();
    });
});
