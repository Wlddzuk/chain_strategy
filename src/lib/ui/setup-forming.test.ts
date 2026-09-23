import { describe, expect, it } from 'vitest';
import type { ChainStrategyState } from '@/lib/trading/chain-strategy';
import type { Candle, Timeframe, Zone } from '@/lib/trading/types';
import {
    deriveBreakFormingSetups,
    deriveFormingSetups,
    getBreakFormingAlertKey,
    getZoneProximity,
    isBreakForming,
    type FormingStrategyStates,
} from './setup-forming';

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

function candle(price: number): Candle {
    return {
        time: NOW,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 100,
    };
}

function zone(
    id: string,
    type: Zone['type'],
    proximalLine: number,
    distalLine: number,
    status: Zone['status'] = 'ACTIVE'
): Zone {
    return {
        id,
        type,
        proximalLine,
        distalLine,
        createdAt: NOW,
        createdAtIndex: 1,
        status,
        strength: 80,
        originCandle: candle(proximalLine),
    };
}

function state(zones: Zone[]): ChainStrategyState {
    return { zones, events: [], signals: [] };
}

function marketStates(entries: Array<[string, Timeframe, ChainStrategyState]>): FormingStrategyStates {
    const result: Record<string, Partial<Record<Timeframe, ChainStrategyState>>> = {};

    for (const [coin, timeframe, strategyState] of entries) {
        result[coin] = { ...result[coin], [timeframe]: strategyState };
    }

    return result;
}

describe('isBreakForming', () => {
    it('requires supply price to trade strictly above the distal line', () => {
        const supply = zone('supply', 'SUPPLY', 100, 102);

        expect(isBreakForming(supply, 102)).toBe(false);
        expect(isBreakForming(supply, 102.0001)).toBe(true);
    });

    it('requires demand price to trade strictly below the distal line', () => {
        const demand = zone('demand', 'DEMAND', 100, 98);

        expect(isBreakForming(demand, 98)).toBe(false);
        expect(isBreakForming(demand, 97.9999)).toBe(true);
    });
});

describe('BREAK_FORMING alert key', () => {
    it('is stable throughout one aligned candle period', () => {
        const periodStart = Date.UTC(2026, 6, 15, 12, 0, 0);

        expect(getBreakFormingAlertKey('SOL', '1h', 'zone-1', periodStart + 1)).toBe(
            getBreakFormingAlertKey('SOL', '1h', 'zone-1', periodStart + 3_599_999)
        );
        expect(getBreakFormingAlertKey('SOL', '1h', 'zone-1', periodStart + 1)).toBe(
            `SOL:1h:zone-1:${periodStart}`
        );
    });

    it('changes at the next candle boundary and for a different market or zone', () => {
        const periodStart = Date.UTC(2026, 6, 15, 12, 0, 0);
        const current = getBreakFormingAlertKey('SOL', '1h', 'zone-1', periodStart);

        expect(getBreakFormingAlertKey('SOL', '1h', 'zone-1', periodStart + 3_600_000)).not.toBe(current);
        expect(getBreakFormingAlertKey('SOL', '15m', 'zone-1', periodStart)).not.toBe(current);
        expect(getBreakFormingAlertKey('ETH', '1h', 'zone-1', periodStart)).not.toBe(current);
        expect(getBreakFormingAlertKey('SOL', '1h', 'zone-2', periodStart)).not.toBe(current);
    });
});

describe('forming setup derivation', () => {
    it('reports price position and distance to the nearest zone edge', () => {
        const demand = zone('demand', 'DEMAND', 100, 98);

        expect(getZoneProximity(demand, 101)).toEqual({
            distancePercent: expect.closeTo((1 / 101) * 100),
            priceRelation: 'above',
        });
        expect(getZoneProximity(demand, 99)).toEqual({
            distancePercent: 0,
            priceRelation: 'inside',
        });
    });

    it('keeps only the nearest active zone per market and sorts markets by proximity', () => {
        const states = marketStates([
            ['SOL', '1h', state([
                zone('sol-far', 'DEMAND', 110, 109),
                zone('sol-near', 'DEMAND', 101, 100),
                zone('sol-event', 'SUPPLY', 100.1, 101, 'EVENT'),
            ])],
            ['BTC', '15m', state([zone('btc', 'SUPPLY', 99, 100.5)])],
            ['ETH', '4h', state([zone('eth-too-far', 'DEMAND', 110, 109)])],
        ]);

        const setups = deriveFormingSetups(states, {
            SOL: 102,
            BTC: 100,
            ETH: 100,
        });

        expect(setups.map((setup) => setup.marketKey)).toEqual(['BTC:15m', 'SOL:1h']);
        expect(setups.find((setup) => setup.coin === 'SOL')?.zone.id).toBe('sol-near');
    });

    it('caps the returned rows after proximity sorting', () => {
        const entries = Array.from({ length: 10 }, (_, index) => {
            const coin = `COIN${index}`;
            return [coin, '1h', state([
                zone(`zone-${index}`, 'DEMAND', 100 + index / 10, 99 + index / 10),
            ])] as [string, Timeframe, ChainStrategyState];
        });
        const prices = Object.fromEntries(entries.map(([coin]) => [coin, 100]));

        expect(deriveFormingSetups(marketStates(entries), prices)).toHaveLength(8);
    });

    it('keeps break candidates even when another zone is nearer or compact rows are capped', () => {
        const entries = Array.from({ length: 9 }, (_, index) => {
            const coin = `COIN${index}`;
            return [coin, '1h', state([
                zone(`near-${index}`, 'DEMAND', 100.1 + index / 100, 99),
            ])] as [string, Timeframe, ChainStrategyState];
        });
        entries.push(['BREAK', '1h', state([
            zone('nearer-zone', 'DEMAND', 100.1, 99),
            zone('hidden-break', 'SUPPLY', 90, 95),
        ])]);
        const prices = {
            ...Object.fromEntries(entries.map(([coin]) => [coin, 100])),
            BREAK: 100,
        };

        const breaks = deriveBreakFormingSetups(marketStates(entries), prices);

        expect(breaks.map((setup) => setup.zone.id)).toContain('hidden-break');
    });
});
