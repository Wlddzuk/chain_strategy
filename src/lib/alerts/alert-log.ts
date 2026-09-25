import type { TradeAlertEvent } from './trade-alert-events';

function getNewSignalKey(event: TradeAlertEvent): string {
    return event.signalId ??
        [event.coin, event.timeframe, event.direction, event.entryPrice].join(':');
}

/**
 * Keeps only the first NEW_SIGNAL alert per signal. Older builds re-announced
 * the same pending signal on every page load, filling the saved log with
 * copies; other alert kinds are real events and are left untouched.
 */
export function dedupeNewSignalAlerts(
    alertLog: readonly TradeAlertEvent[]
): TradeAlertEvent[] {
    const seen = new Set<string>();
    return [...alertLog]
        .sort((first, second) => first.occurredAt - second.occurredAt)
        .filter((event) => {
            if (event.kind !== 'NEW_SIGNAL') return true;
            const key = getNewSignalKey(event);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}
