import { describe, expect, it } from 'vitest';
import type { ChainSignal, TradeParams } from './types';
import { buildRiskDeskUrl, RISK_DESK_URL } from './risk-desk';

const signal = { id: 'BTC:1h:long:1234', coin: 'BTC', timeframe: '1h', direction: 'LONG', entryPrice: 100, stopLoss: 98, takeProfit: 106 } as ChainSignal;
const sizing: TradeParams = { equity: 1000, riskPercent: 1, leverage: 5, entryPrice: 100, stopLoss: 98 };

describe('Risk Desk draft handoff', () => {
    it('uses the fixed private destination and keeps plan values out of the request query', () => {
        const url = new URL(buildRiskDeskUrl(signal, sizing)!);
        expect(url.origin).toBe(new URL(RISK_DESK_URL).origin);
        expect(url.search).toBe('');
        expect(JSON.parse(new URLSearchParams(url.hash.slice(1)).get('chainTrader')!)).toEqual({
            version: 1, source: 'chain-trader', id: signal.id, asset: 'BTC', direction: 'long', timeframe: '1h',
            entry: 100, stop: 98, target: 106, equity: 1000, riskPct: 1, leverage: 5,
        });
    });
    it('retains short direction and exact decimal levels', () => {
        const url = new URL(buildRiskDeskUrl({ ...signal, direction: 'SHORT', entryPrice: 0.1056, stopLoss: 0.106, takeProfit: 0.103 }, { ...sizing, entryPrice: 0.1056, stopLoss: 0.106 })!);
        const payload = JSON.parse(new URLSearchParams(url.hash.slice(1)).get('chainTrader')!);
        expect(payload).toMatchObject({ direction: 'short', entry: 0.1056, stop: 0.106, target: 0.103 });
    });
    it('does not create links for invalid sizing or inconsistent levels', () => {
        expect(buildRiskDeskUrl(signal, { ...sizing, equity: NaN })).toBeNull();
        expect(buildRiskDeskUrl(signal, { ...sizing, leverage: 0 })).toBeNull();
        expect(buildRiskDeskUrl({ ...signal, takeProfit: 90 }, sizing)).toBeNull();
        expect(buildRiskDeskUrl({ ...signal, takeProfit: Infinity }, sizing)).toBeNull();
        expect(buildRiskDeskUrl({ ...signal, stopLoss: 102 }, sizing)).toBeNull();
    });
});
