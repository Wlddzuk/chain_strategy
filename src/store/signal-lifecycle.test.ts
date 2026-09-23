import { describe, expect, it } from 'vitest';
import type { Candle, ChainSignal, Zone } from '@/lib/trading/types';
import { evaluateSignalLifecycle, TOUCHED_STALE_AFTER_MS } from './signal-lifecycle';

const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);

function candle(time: number, close: number): Candle {
    return {
        time,
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
        originCandle: candle(NOW - 60_000, price),
    };
}

function signal(
    status: ChainSignal['status'] = 'PENDING',
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

function evaluate(
    signals: ChainSignal[],
    nextPrice: number,
    options: {
        previousPrice?: number;
        approachThresholdPercent?: number;
        alertedIds?: ReadonlySet<string>;
    } = {}
) {
    return evaluateSignalLifecycle({
        signals,
        previousPrices: options.previousPrice === undefined
            ? {}
            : { BTC: options.previousPrice },
        nextPrices: { BTC: nextPrice },
        approachThresholdPercent: options.approachThresholdPercent ?? 0.25,
        approachingAlertedSignalIds: options.alertedIds ?? new Set(),
        now: NOW,
    });
}

describe('signal lifecycle', () => {
    it.each([102, 106, 98])('never revises an archived touched plan at price %s', (price) => {
        const archived = signal('TOUCHED', { touchedAt: NOW - TOUCHED_STALE_AFTER_MS, closedAt: NOW - 1_000 });
        const result = evaluate([archived], price);
        expect(result.signals[0]).toBe(archived);
        expect(result.alerts).toHaveLength(0);
    });

    it('marks a pending signal TOUCHED when the planned entry trades', () => {
        const result = evaluate([signal()], 100);

        expect(result.signals[0]).toMatchObject({
            status: 'TOUCHED',
            touchedAt: NOW,
        });
        expect(result.signals[0].filledAt).toBeUndefined();
        expect(result.alerts).toHaveLength(1);
        expect(result.alerts[0]).toMatchObject({
            kind: 'ENTRY_HIT',
            signalId: 'btc-1h-long',
            currentPrice: 100,
            occurredAt: NOW,
        });
    });

    it('marks an approved signal FILLED and records its fill timestamp', () => {
        const result = evaluate([signal('APPROVED')], 99.9);

        expect(result.signals[0]).toMatchObject({
            status: 'FILLED',
            touchedAt: NOW,
            filledAt: NOW,
        });
        expect(result.alerts.map((alert) => alert.kind)).toEqual(['ENTRY_HIT']);
    });

    it('marks a setup MISSED when target trades before entry', () => {
        const result = evaluate([signal()], 106);

        expect(result.signals[0]).toMatchObject({
            status: 'MISSED',
            closedAt: NOW,
        });
        expect(result.signals[0].touchedAt).toBeUndefined();
        expect(result.alerts).toMatchObject([{ kind: 'MISSED', urgent: false }]);
    });

    it('invalidates a pending setup silently when price crosses the stop before entry', () => {
        const result = evaluate([signal()], 97.9);

        expect(result.signals[0]).toMatchObject({
            status: 'INVALIDATED',
            closedAt: NOW,
        });
        expect(result.alerts).toMatchObject([{
            kind: 'INVALIDATED',
            signalId: 'btc-1h-long',
            currentPrice: 97.9,
            occurredAt: NOW,
            urgent: false,
        }]);
    });

    it.each([
        { terminalPrice: 97.9, kind: 'INVALIDATED' as const },
        { terminalPrice: 106, kind: 'MISSED' as const },
    ])('makes an approved $kind alert urgent', ({ terminalPrice, kind }) => {
        const result = evaluate([signal('APPROVED')], terminalPrice);

        expect(result.alerts).toMatchObject([{ kind, urgent: true }]);
    });

    it.each([
        { price: 106, outcome: 'WIN' as const },
        { price: 98, outcome: 'LOSS' as const },
    ])('closes a filled signal as $outcome on its price touch', ({ price, outcome }) => {
        const result = evaluate([
            signal('FILLED', { filledAt: NOW - 60_000 }),
        ], price);

        expect(result.signals[0]).toMatchObject({
            status: 'FILLED',
            outcome,
            closedAt: NOW,
        });
        expect(result.alerts.map((alert) => alert.kind)).toEqual([
            outcome === 'WIN' ? 'TARGET_HIT' : 'STOP_HIT',
        ]);
    });

    it.each([
        { price: 106, outcome: 'WIN' as const, kind: 'TARGET_HIT' as const },
        { price: 98, outcome: 'LOSS' as const, kind: 'STOP_HIT' as const },
    ])('records that a touched-only plan would have been a $outcome', ({ price, outcome, kind }) => {
        const result = evaluate([
            signal('TOUCHED', { touchedAt: NOW - 60_000 }),
        ], price);

        expect(result.signals[0]).toMatchObject({
            status: 'TOUCHED',
            outcome,
            closedAt: NOW,
        });
        expect(result.alerts).toMatchObject([{ kind }]);
    });

    it('archives a touched-only plan as stale after 48 hours without inventing an outcome', () => {
        const result = evaluateSignalLifecycle({
            signals: [signal('TOUCHED', {
                touchedAt: NOW - TOUCHED_STALE_AFTER_MS,
            })],
            previousPrices: { BTC: 102 },
            nextPrices: { BTC: 102 },
            approachThresholdPercent: 0.25,
            approachingAlertedSignalIds: new Set(),
            now: NOW,
        });

        expect(result.signals[0]).toMatchObject({
            status: 'TOUCHED',
            closedAt: NOW,
        });
        expect(result.signals[0].outcome).toBeUndefined();
        expect(result.alerts).toHaveLength(0);
    });

    it('alerts on approach only while price moves toward entry and only once', () => {
        const pending = signal();
        const originalSignals = [pending];
        const movingToward = evaluate(originalSignals, 100.2, {
            previousPrice: 100.4,
        });

        expect(movingToward.signals).toBe(originalSignals);
        expect(movingToward.alerts.map((alert) => alert.kind)).toEqual([
            'APPROACHING_ENTRY',
        ]);
        expect(movingToward.approachingAlertedSignalIds).toEqual([pending.id]);

        const movingAway = evaluate([pending], 100.2, {
            previousPrice: 100.1,
        });
        expect(movingAway.alerts).toHaveLength(0);
        expect(movingAway.approachingAlertedSignalIds).toHaveLength(0);

        const alreadyAlerted = evaluate([pending], 100.1, {
            previousPrice: 100.2,
            alertedIds: new Set([pending.id]),
        });
        expect(alreadyAlerted.alerts).toHaveLength(0);
        expect(alreadyAlerted.approachingAlertedSignalIds).toHaveLength(0);
    });

    it('uses the current-price move percentage for the approach boundary', () => {
        const result = evaluate([signal()], 100.2505, {
            previousPrice: 100.5,
            approachThresholdPercent: 0.25,
        });

        expect(result.alerts.map((alert) => alert.kind)).toEqual([
            'APPROACHING_ENTRY',
        ]);
    });
});
