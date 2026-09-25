import type { TradeAlertEvent } from './trade-alert-events';

/**
 * Counts only alert rows the user can actually see in the alert center.
 * Keeping this calculation tied to the visible log prevents a persisted badge
 * from referring to events that have already rotated out of that log.
 */
export function getUnreadAlertCount(
    alertLog: readonly TradeAlertEvent[],
    alertsLastSeenAt: number
): number {
    return alertLog.reduce(
        (count, event) => count + (event.occurredAt > alertsLastSeenAt ? 1 : 0),
        0
    );
}
