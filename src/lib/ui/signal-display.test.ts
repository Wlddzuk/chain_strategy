import { describe, expect, it } from 'vitest';
import { getMoveToEntryPercent } from '@/lib/trading/entry-distance';
import type { ChainSignal } from '@/lib/trading/types';
import {
    formatCompactAge,
    getEntryGuidance,
    getSignalStatusHeadline,
    getSignalStatusLabel,
    NEW_SIGNAL_BADGE_MAX_AGE_MS,
    isActiveSignal,
    isRecentSignal,
} from './signal-display';

function touched(overrides: Partial<ChainSignal> = {}): ChainSignal {
    return {
        id: 'touched-plan',
        status: 'TOUCHED',
        touchedAt: 1,
        ...overrides,
    } as ChainSignal;
}

describe('touched signal display lifecycle', () => {
    it('keeps an unresolved touch active', () => {
        const signal = touched();

        expect(isActiveSignal(signal)).toBe(true);
        expect(isRecentSignal(signal)).toBe(false);
        expect(getSignalStatusLabel(signal)).toBe('ENTRY HIT');
    });

    it.each([
        { outcome: 'WIN' as const, label: 'WOULD HAVE WON' },
        { outcome: 'LOSS' as const, label: 'WOULD HAVE LOST' },
    ])('moves a touched $outcome plan to history', ({ outcome, label }) => {
        const signal = touched({ outcome, closedAt: 2 });

        expect(isActiveSignal(signal)).toBe(false);
        expect(isRecentSignal(signal)).toBe(true);
        expect(getSignalStatusLabel(signal)).toBe(label);
    });

    it('moves a stale touch to history without inventing an outcome', () => {
        const signal = touched({ closedAt: 2 });

        expect(isActiveSignal(signal)).toBe(false);
        expect(isRecentSignal(signal)).toBe(true);
        expect(getSignalStatusLabel(signal)).toBe('ENTRY HIT · STALE');
    });
});

describe('signal status headlines', () => {
    const NOW = 10 * 60 * 60 * 1000;
    const base = {
        ...touched(),
        status: 'PENDING' as const,
        entryPrice: 100,
        riskRewardRatio: 3,
        createdAt: NOW - 60 * 60 * 1000,
        touchedAt: undefined,
    } as ChainSignal;

    it('distinguishes waiting direction from the approaching state', () => {
        expect(getSignalStatusHeadline(base, 105, 0.25, NOW)).toEqual({
            text: '⏳ WAITING — price must drop 4.76% to enter',
            tone: 'waiting',
        });
        expect(getSignalStatusHeadline(base, 100.2, 0.25, NOW)).toEqual({
            text: '⚡ GET READY — price near entry',
            tone: 'ready',
        });
    });

    it('makes touched and outcome states action-first', () => {
        expect(getSignalStatusHeadline(touched({ touchedAt: NOW - 2 * 60 * 60 * 1000 }), 101, 0.25, NOW).text)
            .toBe('⚠️ ENTRY HIT 2h ago — you were not in. Do not chase.');
        expect(getSignalStatusHeadline(touched({ outcome: 'WIN', riskRewardRatio: 3 }), 106, 0.25, NOW).text)
            .toBe('🏁 CLOSED — would have WON +3.0R');
        expect(getSignalStatusHeadline(touched({ outcome: 'LOSS' }), 98, 0.25, NOW).text)
            .toBe('🏁 CLOSED — would have LOST −1.0R');
    });

    it('uses the approved and planned-fill headlines verbatim', () => {
        expect(getSignalStatusHeadline({ ...base, status: 'APPROVED' }, 104, 0.25, NOW)).toEqual({
            text: '📋 ORDER PLAN ACTIVE — waiting for fill',
            tone: 'active',
        });
        expect(getSignalStatusHeadline({ ...base, status: 'FILLED' }, 101, 0.25, NOW)).toEqual({
            text: '✅ IN TRADE (planned) — watching stop & target',
            tone: 'success',
        });
    });

    it('formats the compact chart age without adding a ticking component', () => {
        expect(formatCompactAge(NOW - 17 * 60 * 60 * 1000, NOW)).toBe('17h');
        expect(formatCompactAge(NOW - 3 * 24 * 60 * 60 * 1000, NOW)).toBe('3d');
    });

    it('keeps entry guidance free of banned level jargon', () => {
        const copy = getEntryGuidance(touched(), 101);
        expect(copy).not.toMatch(/\b(?:distal|bookkeeping|traded)\b/i);
    });

    it('uses the same formatted move percentage in the strip, body, and stat', () => {
        const currentPrice = 105;
        const statusText = getSignalStatusHeadline(base, currentPrice, 0.25, NOW).text;
        const guidanceText = getEntryGuidance(base, currentPrice);
        const moveToEntryPercent = getMoveToEntryPercent(
            currentPrice,
            base.entryPrice
        );
        const statText = `−${Math.abs(moveToEntryPercent).toFixed(2)}%`;
        const formattedPercent = (text: string) => text.match(/[+−-]?(\d+\.\d+)%/)?.[1];

        expect(formattedPercent(statusText)).toBe(formattedPercent(guidanceText));
        expect(formattedPercent(guidanceText)).toBe(formattedPercent(statText));
    });
});

describe('NEW signal badge age', () => {
    const createdAt = 1_000_000;
    const pending = {
        ...touched(),
        status: 'PENDING' as const,
        createdAt,
    };

    it('shows NEW only while the signal is less than 60 minutes old', () => {
        expect(getSignalStatusLabel(
            pending,
            createdAt + NEW_SIGNAL_BADGE_MAX_AGE_MS - 1
        )).toBe('NEW');
        expect(getSignalStatusLabel(
            pending,
            createdAt + NEW_SIGNAL_BADGE_MAX_AGE_MS
        )).toBeNull();
        expect(getSignalStatusLabel(pending, 0)).toBeNull();
    });
});
