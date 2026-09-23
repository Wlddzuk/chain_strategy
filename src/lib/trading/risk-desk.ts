import type { ChainSignal, TradeParams } from '@/lib/trading/types';
import { validateTradeParams } from '@/lib/trading/risk-calculator';

export const RISK_DESK_URL = 'https://hyperliquid-risk-desk.wldukdz.chatgpt.site/';

/** A one-way draft handoff. No wallet, credentials, or exchange action is included. */
export function buildRiskDeskUrl(signal: ChainSignal, sizing: TradeParams): string | null {
    if (validateTradeParams(sizing).length > 0) return null;
    const { entryPrice: entry, stopLoss: stop, takeProfit: target } = signal;
    const long = signal.direction === 'LONG';
    if (!Number.isFinite(target) || target <= 0 ||
        (long ? !(stop < entry && target > entry) : !(stop > entry && target < entry))) return null;
    const plan = {
        version: 1,
        source: 'chain-trader',
        id: signal.id,
        asset: signal.coin,
        direction: long ? 'long' : 'short',
        timeframe: signal.timeframe,
        entry,
        stop,
        target,
        equity: sizing.equity,
        riskPct: sizing.riskPercent,
        leverage: sizing.leverage,
    };
    // Fragments stay in the browser instead of appearing in HTTP request logs.
    const url = new URL(RISK_DESK_URL);
    url.hash = new URLSearchParams({ chainTrader: JSON.stringify(plan) }).toString();
    return url.toString();
}
