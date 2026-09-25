import { getMoveToEntryPercent } from '@/lib/trading/entry-distance';
import type { ChainSignal } from '@/lib/trading/types';

export type SignalStatusHeadlineTone =
    | 'waiting'
    | 'ready'
    | 'active'
    | 'warning'
    | 'success'
    | 'danger'
    | 'muted';

export interface SignalStatusHeadline {
    text: string;
    tone: SignalStatusHeadlineTone;
}

export const NEW_SIGNAL_BADGE_MAX_AGE_MS = 60 * 60 * 1000;

export function isActiveSignal(signal: ChainSignal): boolean {
    return signal.status === 'PENDING' ||
        signal.status === 'APPROVED' ||
        (signal.status === 'TOUCHED' && !signal.outcome && !signal.closedAt) ||
        (signal.status === 'FILLED' && !signal.outcome);
}

export function isRecentSignal(signal: ChainSignal): boolean {
    return signal.status === 'MISSED' ||
        signal.status === 'INVALIDATED' ||
        signal.status === 'CANCELLED' ||
        (signal.status === 'TOUCHED' && Boolean(signal.outcome || signal.closedAt)) ||
        (signal.status === 'FILLED' && Boolean(signal.outcome));
}

export function formatRelativeAge(timestamp: number | undefined, now: number): string {
    if (!timestamp || !Number.isFinite(timestamp)) return 'just now';

    const elapsedMinutes = Math.max(0, Math.floor((now - timestamp) / 60000));
    if (elapsedMinutes < 1) return 'just now';
    if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) return `${elapsedHours}h ago`;

    return `${Math.floor(elapsedHours / 24)}d ago`;
}

export function formatCompactAge(timestamp: number | undefined, now: number): string {
    if (!timestamp || !Number.isFinite(timestamp)) return '<1m';

    const elapsedMinutes = Math.max(0, Math.floor((now - timestamp) / 60000));
    if (elapsedMinutes < 1) return '<1m';
    if (elapsedMinutes < 60) return `${elapsedMinutes}m`;

    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) return `${elapsedHours}h`;
    return `${Math.floor(elapsedHours / 24)}d`;
}

export function getSignalStatusHeadline(
    signal: ChainSignal,
    currentPrice: number,
    approachThresholdPercent: number,
    now: number
): SignalStatusHeadline {
    if (signal.outcome === 'WIN') {
        return {
            text: `🏁 CLOSED — would have WON +${signal.riskRewardRatio.toFixed(1)}R`,
            tone: 'success',
        };
    }
    if (signal.outcome === 'LOSS') {
        return { text: '🏁 CLOSED — would have LOST −1.0R', tone: 'danger' };
    }

    switch (signal.status) {
        case 'PENDING': {
            if (!Number.isFinite(currentPrice) || currentPrice <= 0 || signal.entryPrice <= 0) {
                return { text: '⏳ WAITING — waiting for a live price', tone: 'waiting' };
            }

            const moveToEntryPercent = getMoveToEntryPercent(
                currentPrice,
                signal.entryPrice
            );
            const distancePercent = Math.abs(moveToEntryPercent);
            const threshold = Number.isFinite(approachThresholdPercent)
                ? Math.max(0, approachThresholdPercent)
                : 0;
            if (distancePercent <= threshold) {
                return { text: '⚡ GET READY — price near entry', tone: 'ready' };
            }

            const movement = moveToEntryPercent < 0 ? 'drop' : 'rise';
            return {
                text: `⏳ WAITING — price must ${movement} ${distancePercent.toFixed(2)}% to enter`,
                tone: 'waiting',
            };
        }
        case 'APPROVED':
            return { text: '📋 ORDER PLAN ACTIVE — waiting for fill', tone: 'active' };
        case 'TOUCHED': {
            const age = formatRelativeAge(signal.touchedAt, now);
            if (signal.closedAt) {
                return { text: `⚠️ ENTRY HIT ${age} — archived after 48h`, tone: 'warning' };
            }
            return {
                text: `⚠️ ENTRY HIT ${age} — you were not in. Do not chase.`,
                tone: 'warning',
            };
        }
        case 'FILLED':
            return { text: '✅ IN TRADE (planned) — watching stop & target', tone: 'success' };
        case 'MISSED':
            return { text: '⏭️ MISSED — too late. Skip this setup.', tone: 'warning' };
        case 'INVALIDATED':
            return { text: '⛔ SETUP DEAD — cancel any order you placed', tone: 'danger' };
        case 'CANCELLED':
            return { text: '✕ DISMISSED — no action needed', tone: 'muted' };
    }
}

export function getSignalStatusLabel(
    signal: ChainSignal,
    now = Date.now()
): string | null {
    if (signal.status === 'TOUCHED' && signal.outcome === 'WIN') return 'WOULD HAVE WON';
    if (signal.status === 'TOUCHED' && signal.outcome === 'LOSS') return 'WOULD HAVE LOST';
    if (signal.status === 'TOUCHED' && signal.closedAt) return 'ENTRY HIT · STALE';
    if (signal.status === 'FILLED' && signal.outcome) return signal.outcome;

    const labels: Record<ChainSignal['status'], string | null> = {
        PENDING: (
            Number.isFinite(signal.createdAt) &&
            now >= signal.createdAt &&
            now - signal.createdAt < NEW_SIGNAL_BADGE_MAX_AGE_MS
        ) ? 'NEW' : null,
        APPROVED: 'PLANNED',
        TOUCHED: 'ENTRY HIT',
        FILLED: 'TRACKING',
        MISSED: 'MISSED',
        CANCELLED: 'DISMISSED',
        INVALIDATED: 'INVALID',
    };
    return labels[signal.status];
}

export function getSignalStatusBadgeClass(signal: ChainSignal): string {
    if (signal.outcome === 'WIN') return 'badge-long';
    if (signal.outcome === 'LOSS') return 'badge-short';
    if (signal.status === 'FILLED') return 'badge-long';
    if (signal.status === 'TOUCHED' || signal.status === 'MISSED') return 'badge-pending';
    if (signal.status === 'INVALIDATED' || signal.status === 'CANCELLED') return 'badge-short';
    return 'badge-pending';
}

export function getEntryGuidance(signal: ChainSignal, currentPrice: number): string {
    if (!Number.isFinite(currentPrice) || currentPrice <= 0 || signal.entryPrice <= 0) {
        return 'Waiting for a live price to measure the entry distance.';
    }

    const relation = currentPrice >= signal.entryPrice ? 'ABOVE' : 'BELOW';
    if (signal.touchedAt || signal.filledAt || signal.status === 'TOUCHED' || signal.status === 'FILLED') {
        return `Price already reached entry. Price is currently ${relation} the planned entry.`;
    }

    const signedMoveToEntry = getMoveToEntryPercent(
        currentPrice,
        signal.entryPrice
    );
    const direction = signedMoveToEntry < 0 ? 'retrace' : 'rise';
    const sign = signedMoveToEntry > 0 ? '+' : signedMoveToEntry < 0 ? '−' : '';
    const fillRule = signal.direction === 'LONG'
        ? 'LONG fills when price reaches entry or lower.'
        : 'SHORT fills when price reaches entry or higher.';

    if (Math.abs(signedMoveToEntry) < 0.005) {
        return `Price is AT entry. ${fillRule}`;
    }

    return `Price is ${relation} entry; needs ${sign}${Math.abs(signedMoveToEntry).toFixed(2)}% ${direction} to fill. ${fillRule}`;
}
