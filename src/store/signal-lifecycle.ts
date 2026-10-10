import {
    buildTradeAlertEvent,
    type TradeAlertEvent,
} from '@/lib/alerts/trade-alert-events';
import { getMoveToEntryPercent } from '@/lib/trading/entry-distance';
import type { ChainSignal } from '@/lib/trading/types';

interface EvaluateSignalLifecycleOptions {
    signals: ChainSignal[];
    previousPrices: Record<string, number>;
    nextPrices: Record<string, number>;
    approachThresholdPercent: number;
    approachingAlertedSignalIds: ReadonlySet<string>;
    now?: number;
}

export interface SignalLifecycleResult {
    signals: ChainSignal[];
    alerts: TradeAlertEvent[];
    approachingAlertedSignalIds: string[];
}

const WATCHED_UNFILLED_STATUSES = new Set<ChainSignal['status']>(['PENDING', 'APPROVED']);
export const TOUCHED_STALE_AFTER_MS = 48 * 60 * 60 * 1000;
// A new closest approach is saved only when it beats the last by this share of
// the stop distance, so a slow drift toward entry does not rewrite the signal every tick.
const CLOSEST_APPROACH_STEP_R = 0.05;

/**
 * Remembers how near price has come to an unfilled entry. If the plan is later
 * MISSED, this is how much shallower the entry would have needed to be.
 */
function trackClosestApproach(signal: ChainSignal, price: number): ChainSignal {
    // Measured against entry, like the stop distance, so the two divide into R.
    const distancePercent = (Math.abs(price - signal.entryPrice) / signal.entryPrice) * 100;
    if (!Number.isFinite(distancePercent)) return signal;

    const stopDistancePercent = (Math.abs(signal.entryPrice - signal.stopLoss) / signal.entryPrice) * 100;
    const previous = signal.closestEntryApproachPercent;
    if (previous !== undefined && distancePercent > previous - (stopDistancePercent * CLOSEST_APPROACH_STEP_R)) {
        return signal;
    }
    return { ...signal, closestEntryApproachPercent: distancePercent };
}

function reachesEntry(signal: ChainSignal, price: number): boolean {
    return signal.direction === 'LONG'
        ? price <= signal.entryPrice
        : price >= signal.entryPrice;
}

function reachesTarget(signal: ChainSignal, price: number): boolean {
    return signal.direction === 'LONG'
        ? price >= signal.takeProfit
        : price <= signal.takeProfit;
}

function reachesStop(signal: ChainSignal, price: number): boolean {
    return signal.direction === 'LONG'
        ? price <= signal.stopLoss
        : price >= signal.stopLoss;
}

export function evaluateSignalLifecycle({
    signals,
    previousPrices,
    nextPrices,
    approachThresholdPercent,
    approachingAlertedSignalIds,
    now = Date.now(),
}: EvaluateSignalLifecycleOptions): SignalLifecycleResult {
    const alerts: TradeAlertEvent[] = [];
    const newlyApproaching: string[] = [];
    let changed = false;

    const updatedSignals = signals.map((signal) => {
        if (signal.closedAt !== undefined || signal.outcome) return signal;
        const currentPrice = nextPrices[signal.coin];
        if (!Number.isFinite(currentPrice) || currentPrice <= 0) return signal;

        if ((signal.status === 'FILLED' || signal.status === 'TOUCHED') && !signal.outcome) {
            if (reachesTarget(signal, currentPrice)) {
                changed = true;
                alerts.push(buildTradeAlertEvent('TARGET_HIT', signal, currentPrice, now));
                return { ...signal, outcome: 'WIN' as const, closedAt: now };
            }
            if (reachesStop(signal, currentPrice)) {
                changed = true;
                alerts.push(buildTradeAlertEvent('STOP_HIT', signal, currentPrice, now));
                return { ...signal, outcome: 'LOSS' as const, closedAt: now };
            }
            if (
                signal.status === 'TOUCHED' &&
                now - (signal.touchedAt ?? signal.createdAt) >= TOUCHED_STALE_AFTER_MS
            ) {
                changed = true;
                return { ...signal, closedAt: now };
            }
            return signal;
        }

        if (!WATCHED_UNFILLED_STATUSES.has(signal.status)) return signal;

        // A gap through the stop is not recorded as a valid entry touch because
        // no intermediate price update proved that the planned limit was reached first.
        if (reachesStop(signal, currentPrice)) {
            changed = true;
            alerts.push(buildTradeAlertEvent('INVALIDATED', signal, currentPrice, now));
            return { ...signal, status: 'INVALIDATED' as const, closedAt: now };
        }

        if (reachesTarget(signal, currentPrice)) {
            changed = true;
            alerts.push(buildTradeAlertEvent('MISSED', signal, currentPrice, now));
            return { ...signal, status: 'MISSED' as const, closedAt: now };
        }

        if (reachesEntry(signal, currentPrice)) {
            changed = true;
            alerts.push(buildTradeAlertEvent('ENTRY_HIT', signal, currentPrice, now));
            return signal.status === 'APPROVED'
                ? {
                    ...signal,
                    status: 'FILLED' as const,
                    touchedAt: now,
                    filledAt: now,
                }
                : {
                    ...signal,
                    status: 'TOUCHED' as const,
                    touchedAt: now,
                };
        }

        const previousPrice = previousPrices[signal.coin];
        const currentDistancePercent = Math.abs(
            getMoveToEntryPercent(currentPrice, signal.entryPrice)
        );
        const previousDistancePercent = Math.abs(
            getMoveToEntryPercent(previousPrice, signal.entryPrice)
        );
        const tracked = trackClosestApproach(signal, currentPrice);
        if (tracked !== signal) changed = true;
        const movingTowardEntry = Number.isFinite(previousPrice) &&
            currentDistancePercent < previousDistancePercent;
        const isNearEntry = currentDistancePercent <= approachThresholdPercent;

        if (
            movingTowardEntry &&
            isNearEntry &&
            !approachingAlertedSignalIds.has(signal.id)
        ) {
            newlyApproaching.push(signal.id);
            alerts.push(buildTradeAlertEvent('APPROACHING_ENTRY', signal, currentPrice, now));
        }

        return tracked;
    });

    return {
        signals: changed ? updatedSignals : signals,
        alerts,
        approachingAlertedSignalIds: newlyApproaching,
    };
}
