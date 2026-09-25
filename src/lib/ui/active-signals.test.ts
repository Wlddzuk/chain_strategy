import { describe, expect, it } from 'vitest';
import type { ChainSignal } from '@/lib/trading/types';
import {
    selectActiveSignalCount,
    selectActiveSignals,
} from './active-signals';

function signal(
    id: string,
    status: ChainSignal['status'],
    outcome?: ChainSignal['outcome']
): ChainSignal {
    return {
        id,
        status,
        outcome,
    } as ChainSignal;
}

describe('active signal selectors', () => {
    it('gives the KPI and all-markets panel the same active set', () => {
        const signals = [
            signal('pending', 'PENDING'),
            signal('approved', 'APPROVED'),
            signal('tracking', 'FILLED'),
            signal('won', 'FILLED', 'WIN'),
            signal('missed', 'MISSED'),
        ];

        const activeSignals = selectActiveSignals(signals);

        expect(activeSignals.map((item) => item.id)).toEqual([
            'pending',
            'approved',
            'tracking',
        ]);
        expect(selectActiveSignalCount(signals)).toBe(activeSignals.length);
    });
});
