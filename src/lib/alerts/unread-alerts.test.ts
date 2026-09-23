import { describe, expect, it } from 'vitest';
import type { TradeAlertEvent } from './trade-alert-events';
import { getUnreadAlertCount } from './unread-alerts';

function alert(occurredAt: number): TradeAlertEvent {
    return {
        kind: 'NEW_SIGNAL',
        signalId: `signal-${occurredAt}`,
        coin: 'BTC',
        timeframe: '1h',
        direction: 'LONG',
        entryPrice: 100,
        currentPrice: 101,
        distanceToEntryPercent: -1,
        occurredAt,
        urgent: false,
    };
}

describe('getUnreadAlertCount', () => {
    it('always matches the visible rows newer than the seen timestamp', () => {
        const visibleLog = [alert(20), alert(30)];

        expect(getUnreadAlertCount(visibleLog, 15)).toBe(2);
        expect(getUnreadAlertCount(visibleLog, 20)).toBe(1);
        expect(getUnreadAlertCount(visibleLog, 30)).toBe(0);
    });

    it('cannot count alerts that rotated out of the visible persisted log', () => {
        const visibleLog = [alert(91), alert(92)];

        expect(getUnreadAlertCount(visibleLog, 0)).toBe(visibleLog.length);
    });
});
