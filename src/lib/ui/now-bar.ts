import { getMoveToEntryPercent } from '@/lib/trading/entry-distance';
import type { ChainSignal } from '@/lib/trading/types';
import {
    getZoneProximity,
    type FormingSetup,
} from '@/lib/ui/setup-forming';

export type NowBarItem =
    | { kind: 'ENTRY_HIT'; signal: ChainSignal }
    | { kind: 'APPROACHING_ENTRY'; signal: ChainSignal }
    | { kind: 'BREAK_FORMING'; setup: FormingSetup }
    | { kind: 'FORMING'; setup: FormingSetup }
    | { kind: 'IDLE' };

export const NOW_BAR_MIN_HOLD_MS = 15_000;
export const NOW_BAR_RELATIVE_IMPROVEMENT = 0.2;

export interface StableNowBarSelection {
    item: NowBarItem;
    shownAt: number;
    distancePercent: number | null;
}

export interface NowBarRevealActions {
    setShowAllMarkets: (showAllMarkets: boolean) => void;
    acknowledgeEntrySignal: (signalId: string) => void;
    focusSignal: (signalId: string) => void;
    setSelectedCoin: (coin: string) => void;
    setSelectedTimeframe: (timeframe: FormingSetup['timeframe']) => void;
    ensureZonesVisible: () => void;
    focusChart: () => void;
}

interface SelectNowBarItemOptions {
    signals: readonly ChainSignal[];
    prices: Readonly<Record<string, number>>;
    formingSetups: readonly FormingSetup[];
    breakFormingSetups: readonly FormingSetup[];
    acknowledgedEntrySignalIds: ReadonlySet<string>;
    approachThresholdPercent: number;
}

function isUnresolvedEntry(signal: ChainSignal): boolean {
    return !signal.outcome && !signal.closedAt && (
        signal.status === 'TOUCHED' || signal.status === 'FILLED'
    );
}

function isWaitingForEntry(signal: ChainSignal): boolean {
    return signal.status === 'PENDING' || signal.status === 'APPROVED';
}

function getNowBarItemPriority(item: NowBarItem): number {
    switch (item.kind) {
        case 'ENTRY_HIT':
            return 4;
        case 'APPROACHING_ENTRY':
            return 3;
        case 'BREAK_FORMING':
            return 2;
        case 'FORMING':
            return 1;
        case 'IDLE':
            return 0;
    }
}

function getNowBarItemKey(item: NowBarItem): string {
    if (item.kind === 'ENTRY_HIT' || item.kind === 'APPROACHING_ENTRY') {
        return `${item.kind}:${item.signal.id}`;
    }
    if (item.kind === 'BREAK_FORMING' || item.kind === 'FORMING') {
        return `${item.kind}:${item.setup.marketKey}:${item.setup.zone.id}`;
    }
    return 'IDLE';
}

export function isSameNowBarItem(
    first: NowBarItem,
    second: NowBarItem
): boolean {
    return getNowBarItemKey(first) === getNowBarItemKey(second);
}

function getNowBarItemDistance(
    item: NowBarItem,
    prices: Readonly<Record<string, number>>
): number | null {
    if (item.kind === 'ENTRY_HIT' || item.kind === 'APPROACHING_ENTRY') {
        const price = prices[item.signal.coin];
        const distance = Math.abs(
            getMoveToEntryPercent(price, item.signal.entryPrice)
        );
        return Number.isFinite(distance) ? distance : null;
    }
    if (item.kind === 'BREAK_FORMING' || item.kind === 'FORMING') {
        const distance = getZoneProximity(
            item.setup.zone,
            prices[item.setup.coin]
        ).distancePercent;
        return Number.isFinite(distance)
            ? Math.abs(distance)
            : null;
    }
    return null;
}

function createStableSelection(
    item: NowBarItem,
    shownAt: number,
    prices: Readonly<Record<string, number>>
): StableNowBarSelection {
    return {
        item,
        shownAt,
        distancePercent: getNowBarItemDistance(item, prices),
    };
}

export function stabilizeNowBarItem(
    previous: StableNowBarSelection | null,
    candidate: NowBarItem,
    now: number,
    prices: Readonly<Record<string, number>>
): StableNowBarSelection {
    const evaluatedAt = Number.isFinite(now) ? now : Date.now();
    if (!previous) return createStableSelection(candidate, evaluatedAt, prices);

    if (isSameNowBarItem(previous.item, candidate)) return previous;

    const previousPriority = getNowBarItemPriority(previous.item);
    const candidatePriority = getNowBarItemPriority(candidate);
    if (candidatePriority > previousPriority) {
        return createStableSelection(candidate, evaluatedAt, prices);
    }

    if (evaluatedAt - previous.shownAt < NOW_BAR_MIN_HOLD_MS) {
        return previous;
    }

    if (candidatePriority < previousPriority) {
        return createStableSelection(candidate, evaluatedAt, prices);
    }

    const candidateDistance = getNowBarItemDistance(candidate, prices);
    const previousDistance = getNowBarItemDistance(previous.item, prices);
    const isMeaningfullyCloser = (
        candidateDistance !== null &&
        previousDistance !== null &&
        candidateDistance < previousDistance &&
        candidateDistance <= previousDistance * (
            1 - NOW_BAR_RELATIVE_IMPROVEMENT
        )
    );

    return isMeaningfullyCloser
        ? createStableSelection(candidate, evaluatedAt, prices)
        : previous;
}

export function revealNowBarItem(
    item: NowBarItem,
    actions: NowBarRevealActions
): void {
    if (item.kind === 'IDLE') return;

    actions.setShowAllMarkets(true);
    if (item.kind === 'ENTRY_HIT' || item.kind === 'APPROACHING_ENTRY') {
        if (item.kind === 'ENTRY_HIT') {
            actions.acknowledgeEntrySignal(item.signal.id);
        }
        actions.focusSignal(item.signal.id);
        actions.focusChart();
        return;
    }

    actions.setSelectedCoin(item.setup.coin);
    actions.setSelectedTimeframe(item.setup.timeframe);
    actions.ensureZonesVisible();
    actions.focusChart();
}

function isCurrentlyNearEntry(
    signal: ChainSignal,
    prices: Readonly<Record<string, number>>,
    thresholdPercent: number
): boolean {
    const price = prices[signal.coin];
    if (!Number.isFinite(price) || price <= 0 || signal.entryPrice <= 0) return false;
    return Math.abs(getMoveToEntryPercent(price, signal.entryPrice)) <= thresholdPercent;
}

export function selectNowBarItem({
    signals,
    prices,
    formingSetups,
    breakFormingSetups,
    acknowledgedEntrySignalIds,
    approachThresholdPercent,
}: SelectNowBarItemOptions): NowBarItem {
    const unacknowledgedEntry = signals
        .filter((signal) => (
            isUnresolvedEntry(signal) &&
            !acknowledgedEntrySignalIds.has(signal.id)
        ))
        .sort((first, second) => (
            (second.touchedAt ?? second.filledAt ?? second.createdAt) -
            (first.touchedAt ?? first.filledAt ?? first.createdAt)
        ))[0];
    if (unacknowledgedEntry) {
        return { kind: 'ENTRY_HIT', signal: unacknowledgedEntry };
    }

    const safeThreshold = Number.isFinite(approachThresholdPercent)
        ? Math.max(0, approachThresholdPercent)
        : 0;
    const approachingSignal = signals
        .filter((signal) => (
            isWaitingForEntry(signal) &&
            isCurrentlyNearEntry(signal, prices, safeThreshold)
        ))
        .sort((first, second) => second.createdAt - first.createdAt)[0];
    if (approachingSignal) {
        return { kind: 'APPROACHING_ENTRY', signal: approachingSignal };
    }

    const breakForming = breakFormingSetups[0];
    if (breakForming) return { kind: 'BREAK_FORMING', setup: breakForming };

    const nearest = formingSetups[0];
    return nearest ? { kind: 'FORMING', setup: nearest } : { kind: 'IDLE' };
}
