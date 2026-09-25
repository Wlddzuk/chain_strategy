import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRADE_ALERT_EVENT, type TradeAlertEvent } from '@/lib/alerts/trade-alert-events';
import type { Candle, ChainSignal, Zone } from '@/lib/trading/types';
import { useTradingStore } from './trading-store';

const NOW = Date.UTC(2026, 6, 14, 18, 0, 0);
const HOUR = 60 * 60 * 1000;

function candle(time: number, price: number): Candle {
    return { time, open: price, high: price, low: price, close: price, volume: 1 };
}

function marketCandle(
    time: number,
    open: number,
    high: number,
    low: number,
    close: number
): Candle {
    return { time, open, high, low, close, volume: 1000 };
}

function validLongSetup(start: number): Candle[] {
    return [
        marketCandle(start, 105, 106.5, 104.5, 106),
        marketCandle(start + HOUR, 106.2, 106.4, 103.8, 104),
        marketCandle(start + (2 * HOUR), 100, 101.2, 99.8, 101),
        marketCandle(start + (3 * HOUR), 101.1, 101.3, 99.4, 99.5),
        marketCandle(start + (4 * HOUR), 99.5, 99.7, 97.5, 98),
        marketCandle(start + (5 * HOUR), 98, 98.2, 96.8, 97),
        marketCandle(start + (6 * HOUR), 97, 100.2, 96.9, 100),
        marketCandle(start + (7 * HOUR), 100, 102.2, 99.8, 102),
    ];
}

function zone(id: string, createdAt: number, price: number): Zone {
    return {
        id,
        type: 'DEMAND',
        proximalLine: price,
        distalLine: price - 1,
        createdAt,
        createdAtIndex: 10,
        status: 'ACTIVE',
        strength: 70,
        originCandle: candle(createdAt, price),
    };
}

function signal(id: string, createdAt: number, status: ChainSignal['status'] = 'PENDING'): ChainSignal {
    return {
        id,
        coin: 'BTC',
        timeframe: '5m',
        phase: 'ENTRY',
        direction: 'LONG',
        eventZone: zone(`event-${id}`, createdAt - 600_000, 105),
        originZone: zone(`origin-${id}`, createdAt - 300_000, 100),
        entryPrice: 100,
        stopLoss: 98,
        takeProfit: 106,
        riskRewardRatio: 3,
        confidence: 70,
        hasRsiDivergence: false,
        createdAt,
        expiresAt: Number.MAX_SAFE_INTEGER,
        status,
    };
}

describe('trading store signal identity', () => {
    beforeEach(() => {
        useTradingStore.getState().reset();
    });

    it('freezes accepted sizing through later setting changes and price transitions', () => {
        const initialSettings = useTradingStore.getState().settings;
        try {
            useTradingStore.getState().updateSettings({ accountEquity: 10000, riskPercent: 1, leverage: 10 });
            useTradingStore.getState().addSignal(signal('frozen-size', NOW));
            useTradingStore.getState().updateSignalStatus('frozen-size', 'APPROVED');
            useTradingStore.getState().updateSettings({ accountEquity: 5000, riskPercent: 2, leverage: 5 });
            useTradingStore.getState().updatePrice('BTC', 100);
            expect(useTradingStore.getState().signals[0]).toMatchObject({
                status: 'FILLED',
                sizing: { equity: 10000, riskPercent: 1, leverage: 10 },
            });
        } finally {
            useTradingStore.getState().updateSettings(initialSettings);
        }
    });

    it('does not evaluate another market against its cached old quote', () => {
        const pending = { ...signal('other-market', NOW), coin: 'ETH' };
        useTradingStore.setState({ signals: [pending], prices: { ETH: 100 } });
        useTradingStore.getState().updatePrice('BTC', 50_000);
        expect(useTradingStore.getState().signals[0]).toBe(pending);
        useTradingStore.getState().updatePrices({ BTC: 50_001 });
        expect(useTradingStore.getState().signals[0]).toBe(pending);
    });

    it('does not announce a newly discovered plan already passed by the live price', () => {
        useTradingStore.getState().updateCandles('BTC', '1h', validLongSetup(NOW - 8 * HOUR));
        useTradingStore.setState({ prices: { BTC: 106 } });
        useTradingStore.getState().scanMarket('BTC', '1h');
        expect(useTradingStore.getState().signals).toHaveLength(0);
        expect(useTradingStore.getState().alertLog).toHaveLength(0);
        expect(useTradingStore.getState().outcomeHistory).toHaveLength(0);
    });

    it('collapses concurrent rolling-snapshot signals with identical executable levels', () => {
        useTradingStore.getState().addSignal(signal('older-index', NOW));
        useTradingStore.getState().addSignal(signal('newer-index', NOW + 300_000));

        expect(useTradingStore.getState().signals).toHaveLength(1);
        expect(useTradingStore.getState().signals[0].id).toBe('newer-index');
    });

    it('keeps completed history separate from a genuinely new open plan', () => {
        useTradingStore.getState().addSignal({
            ...signal('completed', NOW, 'MISSED'),
            closedAt: NOW + 60_000,
        });
        useTradingStore.getState().addSignal(signal('new-open', NOW + 3_600_000));

        expect(useTradingStore.getState().signals).toHaveLength(2);
    });

    it('syncs and persists the manual execution checklist', () => {
        const approved = signal('checklist', NOW, 'APPROVED');
        const emptyState = { zones: [], events: [], signals: [] };
        useTradingStore.setState({
            signals: [approved],
            plottedSignal: approved,
            strategyStates: {
                BTC: {
                    '5m': { ...emptyState, signals: [approved] },
                    '15m': emptyState,
                    '1h': emptyState,
                    '4h': emptyState,
                },
            },
        });

        useTradingStore.getState().updateExecutionChecklist(
            approved.id,
            'limitOrderPlaced',
            true
        );

        const state = useTradingStore.getState();
        expect(state.signals[0].executionChecklist?.limitOrderPlaced).toBe(true);
        expect(state.strategyStates.BTC['5m'].signals[0].executionChecklist?.limitOrderPlaced).toBe(true);
        expect(state.plottedSignal?.executionChecklist?.limitOrderPlaced).toBe(true);

        const persisted = useTradingStore.persist.getOptions().partialize?.(state) as {
            signals: ChainSignal[];
        };
        expect(persisted.signals[0].executionChecklist?.limitOrderPlaced).toBe(true);
    });
});

describe('trading store candle-close invalidation alerts', () => {
    beforeEach(() => {
        useTradingStore.getState().reset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('emits an urgent cancel-order alert when a scan invalidates an approved plan', () => {
        const dispatched: Array<CustomEvent<TradeAlertEvent>> = [];
        vi.stubGlobal('window', {
            dispatchEvent: (event: CustomEvent<TradeAlertEvent>) => {
                dispatched.push(event);
                return true;
            },
        });

        const now = Date.now();
        const approved = {
            ...signal('approved-scan', now - 900_000, 'APPROVED'),
            originZone: zone('approved-origin', now - 1_200_000, 100),
        };
        useTradingStore.getState().addSignal(approved);
        useTradingStore.getState().setPlottedSignal(approved);
        useTradingStore.getState().updateCandles('BTC', '5m', [
            candle(now - 600_000, 97),
        ]);

        useTradingStore.getState().scanMarket('BTC', '5m');

        expect(useTradingStore.getState().signals[0].status).toBe('INVALIDATED');
        expect(useTradingStore.getState().plottedSignal).toBeNull();
        const alertEvent = dispatched.find((event) => event.type === TRADE_ALERT_EVENT);
        expect(alertEvent?.detail).toMatchObject({
            kind: 'INVALIDATED',
            signalId: 'approved-scan',
            urgent: true,
        });
        expect(useTradingStore.getState().alertLog.at(-1)).toMatchObject({
            kind: 'INVALIDATED',
            signalId: 'approved-scan',
        });
    });
});

describe('trading store alert log', () => {
    beforeEach(() => {
        useTradingStore.getState().reset();
    });

    it('captures a new-signal alert produced by the scan path', () => {
        const start = Date.now() - (12 * HOUR);
        useTradingStore.getState().updateCandles('LOGCOIN', '1h', validLongSetup(start));

        useTradingStore.getState().scanMarket('LOGCOIN', '1h');

        expect(useTradingStore.getState().alertLog).toEqual([
            expect.objectContaining({
                kind: 'NEW_SIGNAL',
                coin: 'LOGCOIN',
            }),
        ]);
    });

    it('captures an entry alert produced by the live lifecycle path', () => {
        const pending = signal('lifecycle-log', Date.now() - 60_000);
        useTradingStore.getState().addSignal(pending);

        useTradingStore.getState().updatePrice('BTC', pending.entryPrice);

        expect(useTradingStore.getState().alertLog.at(-1)).toMatchObject({
            kind: 'ENTRY_HIT',
            signalId: pending.id,
        });
    });

    it('caps the in-memory log at 100 and marks the latest alert seen', () => {
        const pending = signal('log-cap', Date.now() - 60_000);
        const alerts = Array.from({ length: 105 }, (_, index) => ({
            kind: 'NEW_SIGNAL' as const,
            signalId: pending.id,
            coin: pending.coin,
            timeframe: pending.timeframe,
            direction: pending.direction,
            entryPrice: pending.entryPrice,
            currentPrice: pending.entryPrice + 1,
            distanceToEntryPercent: -1,
            occurredAt: index + 1,
            urgent: false,
            hasMarkedExchangeOrders: false,
        }));

        useTradingStore.getState().publishAlerts(alerts);
        useTradingStore.getState().markAlertsSeen();

        const state = useTradingStore.getState();
        expect(state.alertLog).toHaveLength(100);
        expect(state.alertLog[0].occurredAt).toBe(6);
        expect(state.alertsLastSeenAt).toBeGreaterThanOrEqual(105);

        const partialize = useTradingStore.persist.getOptions().partialize;
        const persisted = partialize?.(state) as {
            alertLog: TradeAlertEvent[];
            alertsLastSeenAt: number;
        };
        expect(persisted.alertLog).toHaveLength(20);
        expect(persisted.alertLog[0].occurredAt).toBe(86);
        expect(persisted.alertsLastSeenAt).toBe(state.alertsLastSeenAt);
    });

    it('publishes at most one opt-in BREAK_FORMING alert per zone and candle period', () => {
        const activeSupply: Zone = {
            ...zone('break-forming-zone', NOW, 100),
            type: 'SUPPLY',
            proximalLine: 100,
            distalLine: 102,
        };
        const emptyState = { zones: [], events: [], signals: [] };
        useTradingStore.setState({
            strategyStates: {
                SOL: {
                    '5m': emptyState,
                    '15m': emptyState,
                    '1h': { ...emptyState, zones: [activeSupply] },
                    '4h': emptyState,
                },
            },
        });
        useTradingStore.getState().updateSettings({
            alertsEnabled: true,
            breakFormingAlertsEnabled: true,
        });

        useTradingStore.getState().updatePrice('SOL', 102.1);
        useTradingStore.getState().updatePrice('SOL', 102.2);

        expect(useTradingStore.getState().alertLog.filter(
            (event) => event.kind === 'BREAK_FORMING'
        )).toHaveLength(1);
    });
});

describe('trading store final-spec persistence', () => {
    beforeEach(() => {
        useTradingStore.getState().reset();
    });

    it('records and persists a resolved plan beyond the rotating signals list', () => {
        const filled = {
            ...signal('resolved-history', NOW, 'FILLED'),
            filledAt: NOW,
        };
        useTradingStore.getState().addSignal(filled);

        useTradingStore.getState().updatePrice('BTC', filled.takeProfit);

        const state = useTradingStore.getState();
        expect(state.outcomeHistory).toEqual([
            expect.objectContaining({
                signalId: filled.id,
                coin: 'BTC',
                outcome: 'WIN',
                rMultiple: 3,
            }),
        ]);

        const persisted = useTradingStore.persist.getOptions().partialize?.(state) as {
            outcomeHistory: typeof state.outcomeHistory;
        };
        expect(persisted.outcomeHistory).toEqual(state.outcomeHistory);
    });

    it('persists acknowledgement so an entry-hit Now pin stays dismissed', () => {
        useTradingStore.getState().acknowledgeEntrySignal('entry-hit');

        const state = useTradingStore.getState();
        const persisted = useTradingStore.persist.getOptions().partialize?.(state) as {
            acknowledgedEntrySignalIds: string[];
        };

        expect(persisted.acknowledgedEntrySignalIds).toEqual(['entry-hit']);
    });

    it('lets cross-page actions reveal the all-markets signal panel', () => {
        useTradingStore.getState().setShowAllMarkets(false);
        expect(useTradingStore.getState().showAllMarkets).toBe(false);

        useTradingStore.getState().setShowAllMarkets(true);
        expect(useTradingStore.getState().showAllMarkets).toBe(true);
    });

    it('persists guide and voice preferences while keeping size metadata runtime-only', () => {
        useTradingStore.getState().markGuideSeen();
        useTradingStore.getState().updateSettings({
            preferredVoiceUri: 'voice://samantha',
        });
        useTradingStore.getState().setSizeDecimals({
            BTC: 5,
            DOGE: 0,
        });

        const state = useTradingStore.getState();
        const persisted = useTradingStore.persist.getOptions().partialize?.(state) as {
            hasSeenGuide: boolean;
            settings: typeof state.settings;
            sizeDecimals?: Record<string, number>;
        };

        expect(state.sizeDecimals).toEqual({ BTC: 5, DOGE: 0 });
        expect(persisted.hasSeenGuide).toBe(true);
        expect(persisted.settings.preferredVoiceUri).toBe('voice://samantha');
        expect(persisted.sizeDecimals).toBeUndefined();

        useTradingStore.getState().updateSettings({ preferredVoiceUri: '' });
    });

    it('hydrates safely from empty and legacy-version storage', async () => {
        const options = useTradingStore.persist.getOptions();
        const current = useTradingStore.getState();

        expect(() => options.merge?.(undefined, current)).not.toThrow();

        const legacy = {
            selectedCoin: 'ETH',
            settings: { riskPercent: 2 },
        };
        const migrated = await options.migrate?.(legacy, 0);
        const hydrated = options.merge?.(migrated, current) as typeof current;

        expect(hydrated.selectedCoin).toBe('ETH');
        expect(hydrated.settings.riskPercent).toBe(2);
        expect(hydrated.settings.voiceAlertsEnabled).toBe(true);
        expect(hydrated.settings.preferredVoiceUri).toBe('');
        expect(hydrated.outcomeHistory).toEqual([]);
    });
});
