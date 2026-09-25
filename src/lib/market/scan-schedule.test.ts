import { describe, expect, it } from 'vitest';
import type { ChainSignal } from '@/lib/trading/types';
import {
    getBackgroundScanTimeframes,
    getEligibleScanBoundary,
    shouldUseFastPricePolling,
} from './scan-schedule';

const HOUR = 60 * 60 * 1000;
const BOUNDARY = Date.UTC(2026, 6, 14, 12, 0, 0);

function signal(
    status: ChainSignal['status'],
    overrides: Partial<ChainSignal> = {}
): ChainSignal {
    return {
        id: `signal-${status}`,
        coin: 'BTC',
        timeframe: '1h',
        phase: 'ENTRY',
        direction: 'LONG',
        eventZone: {} as ChainSignal['eventZone'],
        originZone: {} as ChainSignal['originZone'],
        entryPrice: 100,
        stopLoss: 98,
        takeProfit: 106,
        riskRewardRatio: 3,
        confidence: 80,
        hasRsiDivergence: false,
        createdAt: BOUNDARY,
        expiresAt: BOUNDARY + HOUR,
        status,
        ...overrides,
    };
}

describe('background scan scheduling', () => {
    it('does not expose a candle boundary until the grace period has elapsed', () => {
        expect(getEligibleScanBoundary(BOUNDARY + 4_999, '1h')).toBe(BOUNDARY - HOUR);
        expect(getEligibleScanBoundary(BOUNDARY + 5_000, '1h')).toBe(BOUNDARY);
    });

    it('combines the selected timeframe with configured timeframes without duplicates', () => {
        expect(getBackgroundScanTimeframes('15m', ['1h', '15m', '4h'])).toEqual([
            '15m',
            '1h',
            '4h',
        ]);
    });
});

describe('adaptive price polling', () => {
    it.each(['PENDING', 'APPROVED'] as const)(
        'uses the fast interval for a near %s setup',
        (status) => {
            expect(shouldUseFastPricePolling([signal(status)], { BTC: 100.5025 })).toBe(true);
        }
    );

    it('stays on the normal interval for distant, inactive, or invalid-price setups', () => {
        expect(shouldUseFastPricePolling([signal('PENDING')], { BTC: 100.51 })).toBe(false);
        expect(shouldUseFastPricePolling([signal('TOUCHED')], { BTC: 100.1 })).toBe(false);
        expect(shouldUseFastPricePolling([signal('APPROVED')], { BTC: Number.NaN })).toBe(false);
    });
});
