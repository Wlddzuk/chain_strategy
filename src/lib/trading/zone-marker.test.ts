import { describe, expect, it } from 'vitest';
import { findSupersededZoneIds, getZoneFreshness, isZoneTradeable, mergeStackedZones } from './zone-marker';
import { Candle, Zone } from './types';

function zone(id: string, type: Zone['type'], createdAt: number, status: Zone['status'] = 'ACTIVE'): Zone {
    const candle = { time: createdAt, open: 100, high: 101, low: 99, close: 100, volume: 1 };
    return { id, type, proximalLine: 100, distalLine: 99, createdAt, createdAtIndex: 0, status, strength: 70, originCandle: candle };
}

describe('newer engulfing zones supersede older ones', () => {
    it('keeps the newest demand and supply as the main zones', () => {
        const superseded = findSupersededZoneIds([
            zone('demand-1', 'DEMAND', 1),
            zone('demand-5', 'DEMAND', 5),
            zone('supply-2', 'SUPPLY', 2),
            zone('supply-3', 'SUPPLY', 3),
        ]);
        expect([...superseded].sort()).toEqual(['demand-1', 'supply-2']);
    });

    it('ranks demand and supply separately', () => {
        expect(findSupersededZoneIds([zone('demand-1', 'DEMAND', 1), zone('supply-9', 'SUPPLY', 9)]).size).toBe(0);
    });

    it('ignores broken zones and events when picking the newest', () => {
        const superseded = findSupersededZoneIds([
            zone('demand-1', 'DEMAND', 1),
            zone('demand-7', 'DEMAND', 7, 'EVENT'),
            zone('demand-8', 'DEMAND', 8, 'BROKEN'),
        ]);
        expect(superseded.size).toBe(0);
    });

    it('treats a tested zone as still live', () => {
        expect([...findSupersededZoneIds([zone('demand-1', 'DEMAND', 1), zone('demand-4', 'DEMAND', 4, 'TESTED')])]).toEqual(['demand-1']);
    });
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Demand zone 99-100 formed at t=0; each bar is [low, close] an hour apart.
function bars(lowsAndCloses: Array<[number, number]>): Candle[] {
    return lowsAndCloses.map(([low, close], index) => ({
        time: (index + 1) * HOUR, open: close, high: Math.max(close, low) + 1, low, close, volume: 1,
    }));
}

describe('zone freshness', () => {
    const demand = zone('demand', 'DEMAND', 0);

    it('does not count price still sitting at the zone while it forms', () => {
        const freshness = getZoneFreshness(demand, bars([[99.5, 101], [102, 103], [103, 104]]), '1h', 3 * HOUR);
        expect(freshness.returns).toBe(0);
        expect(freshness.spent).toBe(false);
    });

    it('counts a visit once, however many candles it lasts', () => {
        const candles = bars([[102, 103], [103, 104], [104, 105], [99.6, 100.5], [99.4, 100.2], [99.8, 100.4]]);
        const freshness = getZoneFreshness(demand, candles, '1h', 6 * HOUR);
        expect(freshness.returns).toBe(1);
        expect(freshness.firstReturnNow).toBe(true);
        expect(freshness.quickReturn).toBe(false);
    });

    it('flags a first return that came straight back', () => {
        const freshness = getZoneFreshness(demand, bars([[102, 103], [99.5, 100.5]]), '1h', 2 * HOUR);
        expect(freshness.quickReturn).toBe(true);
    });

    it('marks the zone spent on the second return', () => {
        const candles = bars([[102, 103], [103, 104], [104, 105], [99.6, 101], [102, 103], [103, 104], [104, 105], [99.7, 101]]);
        expect(getZoneFreshness(demand, candles, '1h', 8 * HOUR).spent).toBe(true);
    });

    it('stops counting once the zone is broken', () => {
        const candles = bars([[102, 103], [99.6, 101], [102, 103], [97, 98], [102, 103], [99.6, 101]]);
        expect(getZoneFreshness(demand, candles, '1h', 6 * HOUR).returns).toBe(1);
    });

    it('ages out after 4 days on 15m and a month on 4h', () => {
        expect(getZoneFreshness(demand, [], '15m', 4 * DAY).tooOld).toBe(false);
        expect(getZoneFreshness(demand, [], '15m', 4 * DAY + 1).tooOld).toBe(true);
        expect(getZoneFreshness(demand, [], '4h', 30 * DAY + 1).tooOld).toBe(true);
    });

    it('only trades live zones that are neither spent nor too old', () => {
        expect(isZoneTradeable({ ...demand, returns: 1 }, '1h', DAY)).toBe(true);
        expect(isZoneTradeable({ ...demand, returns: 2 }, '1h', DAY)).toBe(false);
        expect(isZoneTradeable(demand, '1h', 31 * DAY)).toBe(false);
        expect(isZoneTradeable({ ...demand, status: 'EVENT' }, '1h', DAY)).toBe(false);
    });
});

describe('stacked zones', () => {
    const at = (id: string, type: Zone['type'], hour: number, proximalLine: number, distalLine: number): Zone => ({
        ...zone(id, type, hour * HOUR), proximalLine, distalLine,
    });

    it('merges same-side zones built one after another into one box', () => {
        const merged = mergeStackedZones([
            at('s1', 'SUPPLY', 0, 110, 112),
            at('s2', 'SUPPLY', 2, 108.5, 110.2),
            at('s3', 'SUPPLY', 4, 107, 108.6),
        ], '1h');
        expect(merged).toHaveLength(1);
        expect(merged[0]).toMatchObject({ proximalLine: 107, distalLine: 112, createdAt: 0, stackedCount: 3 });
    });

    it('keeps zones apart when they are far apart in time or price', () => {
        expect(mergeStackedZones([at('d1', 'DEMAND', 0, 100, 99), at('d2', 'DEMAND', 20, 100, 99)], '1h')).toHaveLength(2);
        expect(mergeStackedZones([at('d1', 'DEMAND', 0, 100, 99), at('d2', 'DEMAND', 1, 95, 94)], '1h')).toHaveLength(2);
    });

    it('never merges demand with supply or touches events', () => {
        const merged = mergeStackedZones([
            at('d1', 'DEMAND', 0, 100, 99),
            at('s1', 'SUPPLY', 1, 100, 101),
            { ...at('e1', 'DEMAND', 2, 100, 99), status: 'EVENT' },
        ], '1h');
        expect(merged.map((item) => item.id).sort()).toEqual(['d1', 'e1', 's1']);
    });
});
