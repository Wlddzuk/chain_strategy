import { describe, expect, it } from 'vitest';
import { dedupeNewSignalAlerts } from './alert-log';
import type { TradeAlertEvent } from './trade-alert-events';

function alert(
    occurredAt: number,
    overrides: Partial<TradeAlertEvent> = {}
): TradeAlertEvent {
    return {
        kind: 'NEW_SIGNAL',
        signalId: 'DOGE-1h-LONG',
        coin: 'DOGE',
        timeframe: '1h',
        direction: 'LONG',
        entryPrice: 0.09517,
        currentPrice: 0.0975,
        distanceToEntryPercent: -2.4,
        occurredAt,
        urgent: false,
        ...overrides,
    };
}

describe('dedupeNewSignalAlerts', () => {
    it('keeps only the first announcement of the same signal', () => {
        const log = [alert(1_000), alert(2_000), alert(3_000), alert(4_000)];

        expect(dedupeNewSignalAlerts(log)).toEqual([alert(1_000)]);
    });

    it('keeps different signals and every non-new-signal event', () => {
        const other = alert(2_000, { signalId: 'BTC-1h-SHORT', coin: 'BTC', direction: 'SHORT' });
        const entryHit = alert(3_000, { kind: 'ENTRY_HIT' });
        const secondEntryHit = alert(4_000, { kind: 'ENTRY_HIT' });
        const log = [alert(1_000), other, entryHit, alert(3_500), secondEntryHit];

        expect(dedupeNewSignalAlerts(log)).toEqual([alert(1_000), other, entryHit, secondEntryHit]);
    });

    it('falls back to market and entry price when an alert has no signal id', () => {
        const log = [
            alert(1_000, { signalId: undefined }),
            alert(2_000, { signalId: undefined }),
            alert(3_000, { signalId: undefined, entryPrice: 0.1 }),
        ];

        expect(dedupeNewSignalAlerts(log)).toHaveLength(2);
    });
});
