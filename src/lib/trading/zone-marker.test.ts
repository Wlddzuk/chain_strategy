import { describe, expect, it } from 'vitest';
import { findSupersededZoneIds } from './zone-marker';
import { Zone } from './types';

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
