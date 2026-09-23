import { describe, expect, it } from 'vitest';
import type { Candle, ChainSignal, Zone } from '@/lib/trading/types';
import { buildTradeAlertEvent } from './trade-alert-events';

const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);

function candle(close: number): Candle {
    return {
        time: NOW - 60_000,
        open: close,
        high: close,
        low: close,
        close,
        volume: 100,
    };
}

function zone(id: string, type: Zone['type'], price: number): Zone {
    return {
        id,
        type,
        proximalLine: price,
        distalLine: price,
        createdAt: NOW - 60_000,
        createdAtIndex: 1,
        status: 'ACTIVE',
        strength: 80,
        originCandle: candle(price),
    };
}

function signal(
    status: ChainSignal['status'],
    overrides: Partial<ChainSignal> = {}
): ChainSignal {
    return {
        id: 'btc-1h-long',
        coin: 'BTC',
        timeframe: '1h',
        phase: 'ENTRY',
        direction: 'LONG',
        eventZone: zone('event', 'SUPPLY', 106),
        originZone: zone('origin', 'DEMAND', 100),
        entryPrice: 100,
        stopLoss: 98,
        takeProfit: 106,
        riskRewardRatio: 3,
        confidence: 85,
        hasRsiDivergence: false,
        createdAt: NOW - 30_000,
        expiresAt: NOW + 3_600_000,
        status,
        ...overrides,
    };
}

describe('buildTradeAlertEvent', () => {
    it('marks entry touches urgent and includes the signed distance to entry', () => {
        const event = buildTradeAlertEvent('ENTRY_HIT', signal('PENDING'), 99, NOW);

        expect(event).toMatchObject({
            kind: 'ENTRY_HIT',
            signalId: 'btc-1h-long',
            urgent: true,
            occurredAt: NOW,
        });
        expect(event.distanceToEntryPercent).toBeCloseTo(1.0101, 4);
    });

    it('uses normal target alerts and urgent stop alerts', () => {
        expect(buildTradeAlertEvent('TARGET_HIT', signal('FILLED'), 106, NOW).urgent).toBe(false);
        expect(buildTradeAlertEvent('STOP_HIT', signal('FILLED'), 98, NOW).urgent).toBe(true);
    });

    it('records whether exchange-order checklist items were marked', () => {
        const event = buildTradeAlertEvent('INVALIDATED', signal('APPROVED', {
            executionChecklist: {
                limitOrderPlaced: true,
                stopSet: false,
                takeProfitSet: false,
            },
        }), 97, NOW);

        expect(event.hasMarkedExchangeOrders).toBe(true);
    });

    it.each([
        signal('PENDING'),
        signal('FILLED', { outcome: 'WIN' }),
    ])('keeps terminal alerts silent without possible exchange exposure', (candidate) => {
        expect(buildTradeAlertEvent('INVALIDATED', candidate, 97, NOW).urgent).toBe(false);
        expect(buildTradeAlertEvent('MISSED', candidate, 106, NOW).urgent).toBe(false);
    });

    it.each([
        signal('APPROVED'),
        signal('TOUCHED'),
        signal('FILLED'),
    ])('makes terminal alerts urgent when a plan may have exchange exposure', (candidate) => {
        expect(buildTradeAlertEvent('INVALIDATED', candidate, 97, NOW).urgent).toBe(true);
        expect(buildTradeAlertEvent('MISSED', candidate, 106, NOW).urgent).toBe(true);
    });

    it('allows scan callers to preserve prior-state urgency explicitly', () => {
        const alreadyInvalidated = signal('INVALIDATED');
        const event = buildTradeAlertEvent(
            'INVALIDATED',
            alreadyInvalidated,
            97,
            NOW,
            { urgent: true }
        );

        expect(event.urgent).toBe(true);
    });
});
