import { describe, expect, it } from 'vitest';
import type { Zone } from '@/lib/trading/types';
import {
    formatFormingSetupConsequence,
    formatFormingSetupPricePosition,
    getZoneBreakSignalDirection,
} from './forming-setup-copy';

function zone(type: Zone['type']): Zone {
    return {
        id: `${type.toLowerCase()}-zone`,
        type,
        proximalLine: 6.6065,
        distalLine: 6.5776,
        createdAt: 1,
        createdAtIndex: 1,
        status: 'ACTIVE',
        strength: 80,
        originCandle: {
            time: 1,
            open: 6.6,
            high: 6.7,
            low: 6.5,
            close: 6.6,
            volume: 1,
        },
    };
}

describe('forming setup consequence copy', () => {
    it('maps a supply break to the LONG direction used by the strategy', () => {
        expect(getZoneBreakSignalDirection('SUPPLY')).toBe('LONG');
        expect(formatFormingSetupConsequence(zone('SUPPLY'))).toBe(
            'SUPPLY 6.5776–6.6065 — candle close beyond it fires a LONG signal'
        );
    });

    it('maps a demand break to the SHORT direction used by the strategy', () => {
        expect(getZoneBreakSignalDirection('DEMAND')).toBe('SHORT');
        expect(formatFormingSetupConsequence(zone('DEMAND'))).toBe(
            'DEMAND 6.5776–6.6065 — candle close beyond it fires a SHORT signal'
        );
    });
});

describe('forming setup price-position copy', () => {
    it('uses zone-edge copy below the 0.05% display threshold', () => {
        expect(formatFormingSetupPricePosition(0.049, 'above')).toBe('price at zone edge');
        expect(formatFormingSetupPricePosition(-0.049, 'below')).toBe('price at zone edge');
    });

    it('keeps the inside-zone wording and normal distance copy', () => {
        expect(formatFormingSetupPricePosition(0, 'inside')).toBe('price inside zone');
        expect(formatFormingSetupPricePosition(0.051, 'above')).toBe('price 0.1% above');
    });
});
