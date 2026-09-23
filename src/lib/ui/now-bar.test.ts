import { describe, expect, it } from 'vitest';
import type { ChainSignal, Zone } from '@/lib/trading/types';
import type { FormingSetup } from '@/lib/ui/setup-forming';
import {
    NOW_BAR_MIN_HOLD_MS,
    revealNowBarItem,
    selectNowBarItem,
    stabilizeNowBarItem,
    type NowBarItem,
} from './now-bar';

const zone: Zone = {
    id: 'zone',
    type: 'DEMAND',
    proximalLine: 100,
    distalLine: 99,
    createdAt: 1,
    createdAtIndex: 1,
    status: 'ACTIVE',
    strength: 80,
    originCandle: { time: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 },
};

function signal(status: ChainSignal['status']): ChainSignal {
    return {
        id: 'signal',
        coin: 'BTC',
        timeframe: '1h',
        phase: 'ENTRY',
        direction: 'LONG',
        eventZone: zone,
        originZone: zone,
        entryPrice: 100,
        stopLoss: 98,
        takeProfit: 106,
        riskRewardRatio: 3,
        confidence: 80,
        hasRsiDivergence: false,
        createdAt: 1,
        expiresAt: 10,
        status,
    };
}

const forming: FormingSetup = {
    marketKey: 'ETH:1h',
    coin: 'ETH',
    timeframe: '1h',
    zone,
    currentPrice: 100,
    distancePercent: 0,
    priceRelation: 'inside',
    breakForming: true,
};

describe('selectNowBarItem', () => {
    it('pins an unacknowledged entry hit above newer lower-priority states', () => {
        const result = selectNowBarItem({
            signals: [{ ...signal('TOUCHED'), touchedAt: 2 }],
            prices: { BTC: 100 },
            formingSetups: [forming],
            breakFormingSetups: [forming],
            acknowledgedEntrySignalIds: new Set(),
            approachThresholdPercent: 0.25,
        });

        expect(result.kind).toBe('ENTRY_HIT');
    });

    it('drops the entry pin after acknowledgement', () => {
        const result = selectNowBarItem({
            signals: [signal('TOUCHED')],
            prices: { BTC: 100 },
            formingSetups: [forming],
            breakFormingSetups: [forming],
            acknowledgedEntrySignalIds: new Set(['signal']),
            approachThresholdPercent: 0.25,
        });

        expect(result.kind).toBe('BREAK_FORMING');
    });

    it('returns idle when there is no live action or forming setup', () => {
        expect(selectNowBarItem({
            signals: [],
            prices: {},
            formingSetups: [],
            breakFormingSetups: [],
            acknowledgedEntrySignalIds: new Set(),
            approachThresholdPercent: 0.25,
        })).toEqual({ kind: 'IDLE' });
    });

    it('keeps a persisted unresolved entry pinned without any alert-log event', () => {
        const touched = { ...signal('TOUCHED'), touchedAt: 5 };
        const result = selectNowBarItem({
            signals: [touched],
            prices: { BTC: 101 },
            formingSetups: [],
            breakFormingSetups: [],
            acknowledgedEntrySignalIds: new Set(),
            approachThresholdPercent: 0.25,
        });

        expect(result).toEqual({ kind: 'ENTRY_HIT', signal: touched });
    });

    it('shows a currently-near waiting signal without relying on an old alert event', () => {
        const pending = signal('PENDING');
        const result = selectNowBarItem({
            signals: [pending],
            prices: { BTC: 100.1 },
            formingSetups: [],
            breakFormingSetups: [],
            acknowledgedEntrySignalIds: new Set(),
            approachThresholdPercent: 0.25,
        });

        expect(result).toEqual({ kind: 'APPROACHING_ENTRY', signal: pending });
    });

    it('uses the current-price move percentage for the near-entry boundary', () => {
        const pending = signal('PENDING');
        const result = selectNowBarItem({
            signals: [pending],
            prices: { BTC: 100.2505 },
            formingSetups: [],
            breakFormingSetups: [],
            acknowledgedEntrySignalIds: new Set(),
            approachThresholdPercent: 0.25,
        });

        expect(result).toEqual({ kind: 'APPROACHING_ENTRY', signal: pending });
    });
});

describe('Now bar stability', () => {
    const firstBreak: NowBarItem = {
        kind: 'BREAK_FORMING',
        setup: {
            ...forming,
            coin: 'AVAX',
            marketKey: 'AVAX:1h',
            distancePercent: 1,
        },
    };
    const slightlyCloserBreak: NowBarItem = {
        kind: 'BREAK_FORMING',
        setup: {
            ...forming,
            coin: 'LINK',
            marketKey: 'LINK:1h',
            distancePercent: 0.9,
        },
    };
    const meaningfullyCloserBreak: NowBarItem = {
        kind: 'BREAK_FORMING',
        setup: {
            ...forming,
            coin: 'BTC',
            marketKey: 'BTC:1h',
            distancePercent: 0.8,
        },
    };
    const setupPrices = {
        AVAX: 101,
        LINK: 100.9,
        BTC: 100.75,
    };

    it('holds a same-priority item for at least 15 seconds', () => {
        const first = stabilizeNowBarItem(null, firstBreak, 0, setupPrices);
        const held = stabilizeNowBarItem(
            first,
            meaningfullyCloserBreak,
            NOW_BAR_MIN_HOLD_MS - 1,
            setupPrices
        );

        expect(held).toBe(first);
    });

    it('switches same-priority items only for at least 20% improvement', () => {
        const first = stabilizeNowBarItem(null, firstBreak, 0, setupPrices);
        const smallImprovement = stabilizeNowBarItem(
            first,
            slightlyCloserBreak,
            NOW_BAR_MIN_HOLD_MS,
            setupPrices
        );
        const meaningfulImprovement = stabilizeNowBarItem(
            first,
            meaningfullyCloserBreak,
            NOW_BAR_MIN_HOLD_MS,
            setupPrices
        );

        expect(smallImprovement).toBe(first);
        expect(meaningfulImprovement.item).toBe(meaningfullyCloserBreak);
    });

    it('allows a higher-priority item to interrupt immediately', () => {
        const first = stabilizeNowBarItem(null, firstBreak, 0, setupPrices);
        const approaching: NowBarItem = {
            kind: 'APPROACHING_ENTRY',
            signal: signal('PENDING'),
        };
        const next = stabilizeNowBarItem(first, approaching, 1, { BTC: 100.1 });

        expect(next.item).toBe(approaching);
    });

    it('compares a challenger with the incumbent setup at its live distance', () => {
        const first = stabilizeNowBarItem(
            null,
            firstBreak,
            0,
            { AVAX: 100.1 }
        );
        const next = stabilizeNowBarItem(
            first,
            meaningfullyCloserBreak,
            NOW_BAR_MIN_HOLD_MS,
            {
                AVAX: 101,
                BTC: 100.7,
            }
        );

        expect(next.item).toBe(meaningfullyCloserBreak);
    });
});

describe('Now bar reveal behavior', () => {
    it('shows all markets before focusing a referenced signal', () => {
        const calls: string[] = [];
        revealNowBarItem(
            { kind: 'APPROACHING_ENTRY', signal: signal('PENDING') },
            {
                setShowAllMarkets: () => calls.push('all-markets'),
                acknowledgeEntrySignal: () => calls.push('acknowledge'),
                focusSignal: () => calls.push('focus-signal'),
                setSelectedCoin: () => calls.push('coin'),
                setSelectedTimeframe: () => calls.push('timeframe'),
                ensureZonesVisible: () => calls.push('zones'),
                focusChart: () => calls.push('chart'),
            }
        );

        expect(calls).toEqual(['all-markets', 'focus-signal', 'chart']);
    });

    it('shows all markets before switching the chart to a referenced zone', () => {
        const calls: string[] = [];
        revealNowBarItem(
            { kind: 'BREAK_FORMING', setup: forming },
            {
                setShowAllMarkets: () => calls.push('all-markets'),
                acknowledgeEntrySignal: () => calls.push('acknowledge'),
                focusSignal: () => calls.push('focus-signal'),
                setSelectedCoin: () => calls.push('coin'),
                setSelectedTimeframe: () => calls.push('timeframe'),
                ensureZonesVisible: () => calls.push('zones'),
                focusChart: () => calls.push('chart'),
            }
        );

        expect(calls).toEqual([
            'all-markets',
            'coin',
            'timeframe',
            'zones',
            'chart',
        ]);
    });
});
