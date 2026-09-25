import { describe, expect, it } from 'vitest';
import type { TradeAlertEvent, TradeAlertKind } from './trade-alert-events';
import {
    getTradeAlertBody,
    getTradeAlertKindLabel,
    getTradeAlertTitle,
} from './trade-alert-presentation';

function alertEvent(
    kind: TradeAlertKind,
    overrides: Partial<TradeAlertEvent> = {}
): TradeAlertEvent {
    return {
        kind,
        signalId: 'btc-1h-long',
        coin: 'BTC',
        timeframe: '1h',
        direction: 'LONG',
        entryPrice: 100,
        currentPrice: 106,
        distanceToEntryPercent: -5.66,
        occurredAt: 1_000,
        urgent: false,
        hasMarkedExchangeOrders: false,
        ...overrides,
    };
}

describe('trade alert presentation', () => {
    it('presents target and stop outcomes in action-first plain language', () => {
        expect(getTradeAlertKindLabel('TARGET_HIT')).toBe('TARGET HIT');
        expect(getTradeAlertTitle(alertEvent('TARGET_HIT'))).toBe('TARGET HIT — LONG BTC 1h');
        expect(getTradeAlertBody(alertEvent('TARGET_HIT'))).toBe(
            'Price reached Target. If you are in this trade, it should have closed in profit.'
        );
        expect(getTradeAlertBody(alertEvent('STOP_HIT', { urgent: true }))).toBe(
            'Price reached Stop. If you are in this trade, it should have closed at a loss.'
        );
    });

    it.each(['MISSED', 'INVALIDATED'] as const)(
        'appends the exact cancel warning for marked exchange orders on %s',
        (kind) => {
            const body = getTradeAlertBody(alertEvent(kind, {
                urgent: true,
                hasMarkedExchangeOrders: true,
            }));

            expect(body).toContain('You marked orders as placed on the exchange — go cancel them.');
        }
    );

    it('supports a forming-zone alert without a signal id', () => {
        const event = alertEvent('BREAK_FORMING', { signalId: undefined });

        expect(getTradeAlertKindLabel(event.kind)).toBe('BREAK FORMING');
        expect(getTradeAlertTitle(event)).toBe('BREAK FORMING — BTC 1h');
    });

    it.each([
        ['NEW_SIGNAL', 'Nothing to do yet. A new plan was created — it only becomes a trade if price comes back to Entry.'],
        ['APPROACHING_ENTRY', 'Get ready. Price is close to Entry. If you want this trade, place your limit order now.'],
        ['ENTRY_HIT', 'Price reached Entry. If you placed the limit order, you should be in the trade now. Check your exchange.'],
        ['TARGET_HIT', 'Price reached Target. If you are in this trade, it should have closed in profit.'],
        ['STOP_HIT', 'Price reached Stop. If you are in this trade, it should have closed at a loss.'],
        ['MISSED', 'Skip this one — it is too late. Price reached Target without ever coming back to Entry.'],
        ['INVALIDATED', 'This setup is dead. If you placed an order for it, cancel that order now.'],
        ['BREAK_FORMING', 'A setup may be forming. Wait — it is only real if the candle closes beyond the zone.'],
    ] as const)('uses the approved copy for %s', (kind, expected) => {
        expect(getTradeAlertBody(alertEvent(kind))).toBe(expected);
    });

    it.each([
        'NEW_SIGNAL',
        'APPROACHING_ENTRY',
        'ENTRY_HIT',
        'TARGET_HIT',
        'STOP_HIT',
        'MISSED',
        'INVALIDATED',
        'BREAK_FORMING',
    ] as const)('does not expose banned jargon in the %s body', (kind) => {
        expect(getTradeAlertBody(alertEvent(kind))).not.toMatch(/\b(?:distal|bookkeeping|traded)\b/i);
    });
});
