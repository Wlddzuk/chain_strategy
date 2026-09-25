import type { TradeAlertEvent, TradeAlertKind } from './trade-alert-events';
import { formatPrice } from '@/lib/ui/format-price';

const KIND_LABELS: Record<TradeAlertKind, string> = {
    NEW_SIGNAL: 'NEW',
    APPROACHING_ENTRY: 'APPROACHING',
    ENTRY_HIT: 'ENTRY HIT',
    TARGET_HIT: 'TARGET HIT',
    STOP_HIT: 'STOP HIT',
    BREAK_FORMING: 'BREAK FORMING',
    MISSED: 'MISSED',
    INVALIDATED: 'INVALIDATED',
};

function formatSignedPercent(value: number): string {
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    return `${sign}${Math.abs(value).toFixed(1)}%`;
}

function getMarkedOrderSuffix(event: TradeAlertEvent): string {
    return event.hasMarkedExchangeOrders
        ? ' You marked orders as placed on the exchange — go cancel them.'
        : '';
}

export function getTradeAlertKindLabel(kind: TradeAlertKind): string {
    return KIND_LABELS[kind];
}

export function getTradeAlertDisplayPrice(event: TradeAlertEvent): number {
    if (
        (event.kind === 'TARGET_HIT' || event.kind === 'STOP_HIT') &&
        Number.isFinite(event.currentPrice) &&
        event.currentPrice > 0
    ) {
        return event.currentPrice;
    }

    return event.entryPrice;
}

export function getTradeAlertTitle(event: TradeAlertEvent): string {
    const entry = formatPrice(event.entryPrice);
    const market = `${event.direction} ${event.coin} ${event.timeframe}`;

    switch (event.kind) {
        case 'NEW_SIGNAL':
            return `${market} — Entry ${entry} (${formatSignedPercent(event.distanceToEntryPercent)} away)`;
        case 'APPROACHING_ENTRY':
            return `APPROACHING — ${market}`;
        case 'ENTRY_HIT':
            return `ENTRY HIT — ${event.direction} ${event.coin} @ ${entry}`;
        case 'TARGET_HIT':
            return `TARGET HIT — ${market}`;
        case 'STOP_HIT':
            return `STOP HIT — ${market}`;
        case 'BREAK_FORMING':
            return `BREAK FORMING — ${event.coin} ${event.timeframe}`;
        case 'MISSED':
            return `MISSED — ${market}`;
        case 'INVALIDATED':
            return `INVALIDATED — ${market}`;
    }
}

export function getTradeAlertBody(event: TradeAlertEvent): string {
    switch (event.kind) {
        case 'NEW_SIGNAL':
            return 'Nothing to do yet. A new plan was created — it only becomes a trade if price comes back to Entry.';
        case 'APPROACHING_ENTRY':
            return 'Get ready. Price is close to Entry. If you want this trade, place your limit order now.';
        case 'ENTRY_HIT':
            return 'Price reached Entry. If you placed the limit order, you should be in the trade now. Check your exchange.';
        case 'TARGET_HIT':
            return 'Price reached Target. If you are in this trade, it should have closed in profit.';
        case 'STOP_HIT':
            return 'Price reached Stop. If you are in this trade, it should have closed at a loss.';
        case 'BREAK_FORMING':
            return 'A setup may be forming. Wait — it is only real if the candle closes beyond the zone.';
        case 'MISSED':
            return `Skip this one — it is too late. Price reached Target without ever coming back to Entry.${getMarkedOrderSuffix(event)}`;
        case 'INVALIDATED':
            return `This setup is dead. If you placed an order for it, cancel that order now.${getMarkedOrderSuffix(event)}`;
    }
}
