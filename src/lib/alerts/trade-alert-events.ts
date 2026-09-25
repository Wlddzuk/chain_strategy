import { getMoveToEntryPercent } from '@/lib/trading/entry-distance';
import type { ChainSignal } from '@/lib/trading/types';

export const TRADE_ALERT_EVENT = 'chain-trader:trade-alert';

export type TradeAlertKind =
    | 'NEW_SIGNAL'
    | 'APPROACHING_ENTRY'
    | 'ENTRY_HIT'
    | 'TARGET_HIT'
    | 'STOP_HIT'
    | 'BREAK_FORMING'
    | 'MISSED'
    | 'INVALIDATED';

export interface BuildTradeAlertOptions {
    urgent?: boolean;
}

export interface TradeAlertEvent {
    kind: TradeAlertKind;
    signalId?: string;
    coin: string;
    timeframe: ChainSignal['timeframe'];
    direction: ChainSignal['direction'];
    entryPrice: number;
    currentPrice: number;
    distanceToEntryPercent: number;
    occurredAt: number;
    urgent: boolean;
    hasMarkedExchangeOrders?: boolean;
}

function hasPossibleExchangeExposure(signal: ChainSignal): boolean {
    return signal.status === 'APPROVED' ||
        signal.status === 'TOUCHED' ||
        (signal.status === 'FILLED' && !signal.outcome);
}

function getDefaultUrgency(kind: TradeAlertKind, signal: ChainSignal): boolean {
    if (kind === 'ENTRY_HIT' || kind === 'STOP_HIT') return true;
    if (kind !== 'INVALIDATED' && kind !== 'MISSED') return false;
    return hasPossibleExchangeExposure(signal);
}

function hasMarkedExchangeOrders(signal: ChainSignal): boolean {
    const checklist = signal.executionChecklist;
    return Boolean(
        checklist?.limitOrderPlaced ||
        checklist?.stopSet ||
        checklist?.takeProfitSet
    );
}

export function buildTradeAlertEvent(
    kind: TradeAlertKind,
    signal: ChainSignal,
    currentPrice: number,
    occurredAt = Date.now(),
    options: BuildTradeAlertOptions = {}
): TradeAlertEvent {
    const moveToEntryPercent = getMoveToEntryPercent(
        currentPrice,
        signal.entryPrice
    );
    const distanceToEntryPercent = Number.isFinite(moveToEntryPercent)
        ? moveToEntryPercent
        : 0;

    return {
        kind,
        signalId: signal.id,
        coin: signal.coin,
        timeframe: signal.timeframe,
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        currentPrice,
        distanceToEntryPercent,
        occurredAt,
        urgent: options.urgent ?? getDefaultUrgency(kind, signal),
        hasMarkedExchangeOrders: hasMarkedExchangeOrders(signal),
    };
}

export function emitTradeAlert(event: TradeAlertEvent): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent<TradeAlertEvent>(TRADE_ALERT_EVENT, { detail: event }));
}
