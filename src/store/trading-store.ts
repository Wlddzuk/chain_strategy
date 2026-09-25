// Trading Store - Zustand state management
// Manages candles, zones, signals, settings, and WebSocket connections

import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import {
    buildTradeAlertEvent,
    emitTradeAlert,
    type TradeAlertEvent,
} from '../lib/alerts/trade-alert-events';
import {
    Candle,
    ChainSignal,
    Timeframe as TradingTimeframe,
    getTimeframeMs,
} from '../lib/trading/types';
import { ChainStrategyState, scanForSignals } from '../lib/trading/chain-strategy';
import { getMoveToEntryPercent } from '../lib/trading/entry-distance';
import { getTradePlanKey, isOpenSignalWorkflow } from '../lib/trading/signal-identity';
import {
    deriveFormingSetups,
    getBreakFormingAlertKey,
} from '../lib/ui/setup-forming';
import {
    appendOutcomeHistory,
    type OutcomeHistoryItem,
} from '../lib/ui/strategy-record';
import { evaluateSignalLifecycle } from './signal-lifecycle';

export type Timeframe = TradingTimeframe;

export interface TradingSettings {
    accountEquity: number;
    riskPercent: number;
    leverage: number;
    walletAddress: string;
    alertsEnabled: boolean;
    soundEnabled: boolean;
    voiceAlertsEnabled: boolean;
    preferredVoiceUri: string;
    soundVolume: number;
    infoSoundsEnabled: boolean;
    headsUpSoundsEnabled: boolean;
    actionOutcomeSoundsEnabled: boolean;
    browserNotificationsEnabled: boolean;
    approachThresholdPercent: number;
    minStopDistancePercent: number;
    maxRiskRewardRatio: number;
    feePercentPerSide: number;
    farFromEntryPercent: number;
    scanTimeframes: Timeframe[];
    breakFormingAlertsEnabled: boolean;
    // Note: Private key should be stored securely, not in plain state
}

export interface CoinData {
    candles: Candle[];
    lastUpdate: number;
    isLive: boolean;
}

interface TradingState {
    // Selected coin and timeframe
    selectedCoin: string;
    selectedTimeframe: Timeframe;

    // Available coins to trade
    availableCoins: string[];

    // Candle data per coin/timeframe
    candleData: Record<string, Record<Timeframe, CoinData>>;

    // Strategy state per coin/timeframe
    strategyStates: Record<string, Record<Timeframe, ChainStrategyState>>;

    // All signals (pending, approved, etc.)
    signals: ChainSignal[];

    // Compact terminal history survives the rotating signal list.
    outcomeHistory: OutcomeHistoryItem[];

    // Current prices
    prices: Record<string, number>;
    sizeDecimals: Record<string, number>;

    // User settings
    settings: TradingSettings;

    // UI state
    isScanning: boolean;
    lastScanTime: number | null;
    alertLog: TradeAlertEvent[];
    alertsLastSeenAt: number;
    acknowledgedEntrySignalIds: string[];
    hasSeenGuide: boolean;
    showAllMarkets: boolean;

    // Chart visualization state
    plottedSignal: ChainSignal | null;
    selectedSignalId: string | null;
    showZones: boolean;

    // Actions
    setSelectedCoin: (coin: string) => void;
    setSelectedTimeframe: (tf: Timeframe) => void;
    setAvailableCoins: (coins: string[]) => void;

    updateCandles: (coin: string, timeframe: Timeframe, candles: Candle[]) => void;
    appendCandle: (coin: string, timeframe: Timeframe, candle: Candle, isClosed: boolean) => void;

    updatePrice: (coin: string, price: number) => void;
    updatePrices: (prices: Record<string, number>) => void;
    setSizeDecimals: (sizeDecimals: Record<string, number>) => void;

    scanMarket: (coin: string, timeframe: Timeframe) => void;
    runScan: () => void;
    publishAlerts: (alerts: TradeAlertEvent[]) => void;
    markAlertsSeen: () => void;
    acknowledgeEntrySignal: (signalId: string) => void;
    markGuideSeen: () => void;
    setShowAllMarkets: (showAllMarkets: boolean) => void;

    addSignal: (signal: ChainSignal) => void;
    updateSignalStatus: (signalId: string, status: ChainSignal['status']) => void;
    updateExecutionChecklist: (
        signalId: string,
        item: keyof NonNullable<ChainSignal['executionChecklist']>,
        checked: boolean
    ) => void;
    removeSignal: (signalId: string) => void;

    updateSettings: (settings: Partial<TradingSettings>) => void;

    // Chart visualization actions
    setPlottedSignal: (signal: ChainSignal | null) => void;
    selectSignal: (signalId: string | null) => void;
    focusSignal: (signalId: string) => void;
    toggleZones: () => void;

    reset: () => void;
}

const initialSettings: TradingSettings = {
    accountEquity: 10000,
    riskPercent: 1,
    leverage: 10,
    walletAddress: '',
    alertsEnabled: true,
    soundEnabled: true,
    voiceAlertsEnabled: true,
    preferredVoiceUri: '',
    soundVolume: 60,
    infoSoundsEnabled: true,
    headsUpSoundsEnabled: true,
    actionOutcomeSoundsEnabled: true,
    browserNotificationsEnabled: false,
    approachThresholdPercent: 0.25,
    minStopDistancePercent: 0.4,
    maxRiskRewardRatio: 8,
    feePercentPerSide: 0.045,
    farFromEntryPercent: 3,
    scanTimeframes: ['1h'],
    breakFormingAlertsEnabled: false,
};

const defaultCoins = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'AVAX', 'LINK', 'ARB'];

const signalStatusPriority: Record<ChainSignal['status'], number> = {
    PENDING: 0,
    APPROVED: 1,
    TOUCHED: 2,
    INVALIDATED: 3,
    MISSED: 3,
    CANCELLED: 3,
    FILLED: 4,
};

const alertedNewSignalKeys = new Set<string>();
const approachingAlertedSignalIds = new Set<string>();
const alertedScanInvalidationKeys = new Set<string>();
const alertedBreakFormingKeys = new Set<string>();

function getSignalSetupKey(signal: ChainSignal): string {
    return [
        signal.coin,
        signal.timeframe,
        signal.direction,
        signal.eventZone.createdAt,
        signal.originZone.createdAt,
    ].join(':');
}

function findMatchingSignal(signals: ChainSignal[], reference: ChainSignal): ChainSignal | undefined {
    return signals.find((signal) => getSignalSetupKey(signal) === getSignalSetupKey(reference)) ??
        signals.find((signal) => (
            isOpenSignalWorkflow(signal) &&
            isOpenSignalWorkflow(reference) &&
            getTradePlanKey(signal) === getTradePlanKey(reference)
        ));
}

function getSignalProgress(signal: ChainSignal): number {
    return (signal.status === 'FILLED' && signal.outcome) ||
        (signal.status === 'TOUCHED' && Boolean(signal.outcome || signal.closedAt))
        ? 5
        : signalStatusPriority[signal.status];
}

function mergeSignal(existing: ChainSignal, incoming: ChainSignal): ChainSignal {
    const existingProgress = getSignalProgress(existing);
    const incomingProgress = getSignalProgress(incoming);
    if (incomingProgress > existingProgress) {
        return {
            ...incoming,
            executionChecklist: incoming.executionChecklist ?? existing.executionChecklist,
            sizing: incoming.sizing ?? existing.sizing,
        };
    }
    if (incomingProgress < existingProgress) return existing;

    return {
        ...incoming,
        ...existing,
        touchedAt: existing.touchedAt ?? incoming.touchedAt,
        filledAt: existing.filledAt ?? incoming.filledAt,
        outcome: existing.outcome ?? incoming.outcome,
        closedAt: existing.closedAt ?? incoming.closedAt,
        divergence: existing.divergence ?? incoming.divergence,
        executionChecklist: existing.executionChecklist ?? incoming.executionChecklist,
    };
}

function mergeSignals(signals: ChainSignal[]): ChainSignal[] {
    const mergedBySetup = new Map<string, ChainSignal>();

    for (const signal of signals) {
        const key = getSignalSetupKey(signal);
        const existing = mergedBySetup.get(key);
        mergedBySetup.set(key, existing ? mergeSignal(existing, signal) : signal);
    }

    const mergedSignals: ChainSignal[] = [];
    const openPlanIndexes = new Map<string, number>();

    for (const signal of mergedBySetup.values()) {
        if (!isOpenSignalWorkflow(signal)) {
            mergedSignals.push(signal);
            continue;
        }

        const planKey = getTradePlanKey(signal);
        const existingIndex = openPlanIndexes.get(planKey);
        if (existingIndex === undefined) {
            openPlanIndexes.set(planKey, mergedSignals.length);
            mergedSignals.push(signal);
            continue;
        }

        const existing = mergedSignals[existingIndex];
        const existingProgress = getSignalProgress(existing);
        const incomingProgress = getSignalProgress(signal);
        if (incomingProgress > existingProgress) {
            mergedSignals[existingIndex] = signal;
        } else if (incomingProgress === existingProgress && signal.createdAt > existing.createdAt) {
            mergedSignals[existingIndex] = signal;
        }
    }

    const unchanged = mergedSignals.length === signals.length &&
        mergedSignals.every((signal, index) => signal === signals[index]);
    return unchanged ? signals : mergedSignals;
}

function cloneStrategyState(state: ChainStrategyState): ChainStrategyState {
    return typeof structuredClone === 'function'
        ? structuredClone(state)
        : JSON.parse(JSON.stringify(state)) as ChainStrategyState;
}

function syncStrategySignals(
    strategyStates: TradingState['strategyStates'],
    signals: ChainSignal[]
): TradingState['strategyStates'] {
    const signalsByKey = new Map(signals.map((signal) => [getSignalSetupKey(signal), signal]));
    let changed = false;
    const nextStates: TradingState['strategyStates'] = { ...strategyStates };

    for (const [coin, timeframeStates] of Object.entries(strategyStates)) {
        let nextTimeframeStates = timeframeStates;
        for (const [timeframe, strategyState] of Object.entries(timeframeStates) as Array<[Timeframe, ChainStrategyState]>) {
            let timeframeChanged = false;
            const nextSignals = strategyState.signals.map((signal) => {
                const updated = signalsByKey.get(getSignalSetupKey(signal));
                if (updated && updated !== signal) timeframeChanged = true;
                return updated ?? signal;
            });
            if (!timeframeChanged) continue;
            if (nextTimeframeStates === timeframeStates) nextTimeframeStates = { ...timeframeStates };
            nextTimeframeStates[timeframe] = { ...strategyState, signals: nextSignals };
            changed = true;
        }
        if (nextTimeframeStates !== timeframeStates) nextStates[coin] = nextTimeframeStates;
    }

    return changed ? nextStates : strategyStates;
}

function getHigherTimeframeForRange(timeframe: Timeframe): Timeframe | null {
    if (timeframe === '5m' || timeframe === '15m') {
        return '1h';
    }

    return null;
}

function collectBreakFormingAlerts(
    state: Pick<TradingState, 'settings' | 'strategyStates'>,
    prices: Record<string, number>,
    now = Date.now()
): TradeAlertEvent[] {
    if (!state.settings.alertsEnabled || !state.settings.breakFormingAlertsEnabled) return [];

    const alerts = deriveFormingSetups(state.strategyStates, prices)
        .filter((setup) => setup.breakForming)
        .flatMap((setup) => {
            const key = getBreakFormingAlertKey(
                setup.coin,
                setup.timeframe,
                setup.zone.id,
                now
            );
            if (alertedBreakFormingKeys.has(key)) return [];
            alertedBreakFormingKeys.add(key);
            const moveToEntryPercent = getMoveToEntryPercent(
                setup.currentPrice,
                setup.zone.distalLine
            );

            return [{
                kind: 'BREAK_FORMING' as const,
                coin: setup.coin,
                timeframe: setup.timeframe,
                direction: setup.zone.type === 'SUPPLY' ? 'LONG' as const : 'SHORT' as const,
                entryPrice: setup.zone.distalLine,
                currentPrice: setup.currentPrice,
                distanceToEntryPercent: Number.isFinite(moveToEntryPercent)
                    ? moveToEntryPercent
                    : 0,
                occurredAt: now,
                urgent: false,
            }];
        });

    while (alertedBreakFormingKeys.size > 1000) {
        const oldestKey = alertedBreakFormingKeys.values().next().value;
        if (oldestKey === undefined) break;
        alertedBreakFormingKeys.delete(oldestKey);
    }

    return alerts;
}

function createDebouncedStorage(delayMs = 1000): StateStorage {
    if (typeof window === 'undefined') {
        return {
            getItem: () => null,
            removeItem: () => undefined,
            setItem: () => undefined,
        };
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: { key: string; value: string } | null = null;

    const flush = () => {
        if (pending) localStorage.setItem(pending.key, pending.value);
        pending = null;
        timer = null;
    };

    window.addEventListener('beforeunload', flush);

    return {
        getItem: (key) => localStorage.getItem(key),
        removeItem: (key) => {
            if (pending?.key === key) {
                pending = null;
                if (timer) clearTimeout(timer);
                timer = null;
            }
            localStorage.removeItem(key);
        },
        setItem: (key, value) => {
            pending = { key, value };
            if (!timer) timer = setTimeout(flush, delayMs);
        },
    };
}

export const useTradingStore = create<TradingState>()(
    persist(
        (set, get) => ({
            // Initial state
            selectedCoin: 'BTC',
            selectedTimeframe: '1h',
            availableCoins: defaultCoins,
            candleData: {},
            strategyStates: {},
            signals: [],
            outcomeHistory: [],
            prices: {},
            sizeDecimals: {},
            settings: initialSettings,
            isScanning: false,
            lastScanTime: null,
            alertLog: [],
            alertsLastSeenAt: 0,
            acknowledgedEntrySignalIds: [],
            hasSeenGuide: false,
            showAllMarkets: true,
            plottedSignal: null,
            selectedSignalId: null,
            showZones: true,

            // Actions
            setSelectedCoin: (coin) => set({ selectedCoin: coin }),

            setSelectedTimeframe: (tf) => set({ selectedTimeframe: tf }),

            setAvailableCoins: (coins) => set({ availableCoins: coins }),

            setSizeDecimals: (sizeDecimals) => set({ sizeDecimals }),

            updateCandles: (coin, timeframe, candles) => {
                set((state) => ({
                    candleData: {
                        ...state.candleData,
                        [coin]: {
                            ...state.candleData[coin],
                            [timeframe]: {
                                candles,
                                lastUpdate: Date.now(),
                                isLive: false,
                            },
                        },
                    },
                }));
            },

            appendCandle: (coin, timeframe, candle, isClosed) => {
                let advancedToNewCandle = false;

                set((state) => {
                    const existing = state.candleData[coin]?.[timeframe]?.candles || [];
                    let updated: Candle[];
                    const lastCandle = existing[existing.length - 1];

                    if (!lastCandle) {
                        updated = [candle];
                    } else if (lastCandle.time === candle.time) {
                        // Update the current bar in place without rebuilding history.
                        updated = [...existing.slice(0, -1), candle];
                    } else if (candle.time > lastCandle.time) {
                        // A new forming bar means the previous bar has closed.
                        advancedToNewCandle = true;
                        updated = [...existing, candle];
                    } else {
                        // Reconnect snapshots can contain older bars. Upsert them safely.
                        const existingIndex = existing.findIndex((item) => item.time === candle.time);
                        if (existingIndex < 0) {
                            updated = existing;
                        } else {
                            updated = [...existing];
                            updated[existingIndex] = candle;
                        }
                    }

                    // Keep last 500 candles
                    if (updated.length > 500) {
                        updated = updated.slice(-500);
                    }

                    return {
                        candleData: {
                            ...state.candleData,
                            [coin]: {
                                ...state.candleData[coin],
                                [timeframe]: {
                                    candles: updated,
                                    lastUpdate: Date.now(),
                                    isLive: true,
                                },
                            },
                        },
                    };
                });

                if (isClosed || advancedToNewCandle) {
                    get().scanMarket(coin, timeframe);
                }
            },

            updatePrice: (coin, price) => {
                if (!Number.isFinite(price) || price <= 0) return;
                const state = get();
                const nextPrices = { ...state.prices, [coin]: price };
                const lifecycle = evaluateSignalLifecycle({
                    signals: state.signals,
                    previousPrices: state.prices,
                    nextPrices: { [coin]: price },
                    approachThresholdPercent: state.settings.approachThresholdPercent,
                    approachingAlertedSignalIds,
                });
                lifecycle.approachingAlertedSignalIds.forEach((id) => approachingAlertedSignalIds.add(id));

                const signals = mergeSignals(lifecycle.signals);
                const outcomeHistory = signals === state.signals
                    ? state.outcomeHistory
                    : appendOutcomeHistory(
                        state.outcomeHistory,
                        state.signals,
                        signals
                    );
                const strategyStates = signals === state.signals
                    ? state.strategyStates
                    : syncStrategySignals(state.strategyStates, signals);
                const plottedSignal = state.plottedSignal
                    ? findMatchingSignal(signals, state.plottedSignal) ?? state.plottedSignal
                    : null;
                const shouldClearPlot = plottedSignal && ['MISSED', 'INVALIDATED', 'CANCELLED'].includes(plottedSignal.status);

                set({
                    prices: nextPrices,
                    signals,
                    outcomeHistory,
                    strategyStates,
                    plottedSignal: shouldClearPlot ? null : plottedSignal,
                });
                get().publishAlerts([
                    ...lifecycle.alerts,
                    ...collectBreakFormingAlerts(state, nextPrices),
                ]);
            },

            updatePrices: (prices) => {
                const validPrices = Object.fromEntries(
                    Object.entries(prices).filter(([, price]) => Number.isFinite(price) && price > 0)
                );
                if (Object.keys(validPrices).length === 0) return;

                const state = get();
                const nextPrices = { ...state.prices, ...validPrices };
                const lifecycle = evaluateSignalLifecycle({
                    signals: state.signals,
                    previousPrices: state.prices,
                    nextPrices: validPrices,
                    approachThresholdPercent: state.settings.approachThresholdPercent,
                    approachingAlertedSignalIds,
                });
                lifecycle.approachingAlertedSignalIds.forEach((id) => approachingAlertedSignalIds.add(id));

                const signals = mergeSignals(lifecycle.signals);
                const outcomeHistory = signals === state.signals
                    ? state.outcomeHistory
                    : appendOutcomeHistory(
                        state.outcomeHistory,
                        state.signals,
                        signals
                    );
                const strategyStates = signals === state.signals
                    ? state.strategyStates
                    : syncStrategySignals(state.strategyStates, signals);
                const plottedSignal = state.plottedSignal
                    ? findMatchingSignal(signals, state.plottedSignal) ?? state.plottedSignal
                    : null;
                const shouldClearPlot = plottedSignal && ['MISSED', 'INVALIDATED', 'CANCELLED'].includes(plottedSignal.status);

                set({
                    prices: nextPrices,
                    signals,
                    outcomeHistory,
                    strategyStates,
                    plottedSignal: shouldClearPlot ? null : plottedSignal,
                });
                get().publishAlerts([
                    ...lifecycle.alerts,
                    ...collectBreakFormingAlerts(state, nextPrices),
                ]);
            },

            scanMarket: (coin, timeframe) => {
                const state = get();
                const coinData = state.candleData[coin]?.[timeframe];
                if (!coinData?.candles.length) return;

                const closedCandles = coinData.candles.filter(
                    (candle) => candle.time + getTimeframeMs(timeframe) <= Date.now()
                );
                if (!closedCandles.length) return;

                try {
                    const existingState = state.strategyStates[coin]?.[timeframe];
                    const marketSignals = state.signals.filter(
                        (signal) => signal.coin === coin && signal.timeframe === timeframe
                    );
                    const scanState = existingState
                        ? cloneStrategyState(existingState)
                        : { zones: [], events: [], signals: [] };
                    scanState.signals = mergeSignals([...scanState.signals, ...marketSignals]);

                    const higherTimeframe = getHigherTimeframeForRange(timeframe);
                    const higherTimeframeCandles = higherTimeframe
                        ? state.candleData[coin]?.[higherTimeframe]?.candles.filter(
                            (candle) => candle.time + getTimeframeMs(higherTimeframe) <= Date.now()
                        )
                        : undefined;
                    const preScanSignals = scanState.signals;

                    const result = scanForSignals(
                        closedCandles,
                        coin,
                        timeframe,
                        scanState,
                        {
                            higherTimeframe: higherTimeframe || undefined,
                            higherTimeframeCandles,
                            minRiskReward: 2,
                            minStopDistancePercent: state.settings.minStopDistancePercent,
                            maxRiskRewardRatio: state.settings.maxRiskRewardRatio,
                        }
                    );

                    // A snapshot can discover an old trigger after today's quote
                    // has already passed its entry/target. Do not emit a new-plan
                    // alert followed by a fabricated historical outcome.
                    const currentPrice = state.prices[coin];
                    if (Number.isFinite(currentPrice) && currentPrice > 0) {
                        const alreadyPassed = new Set(result.newSignals.filter((signal) =>
                            signal.direction === 'LONG'
                                ? currentPrice <= signal.entryPrice || currentPrice >= signal.takeProfit
                                : currentPrice >= signal.entryPrice || currentPrice <= signal.takeProfit
                        ).map((signal) => signal.id));
                        result.state.signals = result.state.signals.filter((signal) => !alreadyPassed.has(signal.id));
                    }

                    const mergedSignals = mergeSignals([...state.signals, ...result.state.signals]);
                    const outcomeHistory = mergedSignals === state.signals
                        ? state.outcomeHistory
                        : appendOutcomeHistory(
                            state.outcomeHistory,
                            state.signals,
                            mergedSignals
                        );
                    const mergedMarketSignals = mergedSignals.filter(
                        (signal) => signal.coin === coin && signal.timeframe === timeframe
                    );
                    const nextStrategyState = { ...result.state, signals: mergedMarketSignals };
                    const plottedSignal = state.plottedSignal
                        ? findMatchingSignal(mergedSignals, state.plottedSignal) ?? state.plottedSignal
                        : null;
                    const shouldClearPlot = plottedSignal &&
                        ['MISSED', 'INVALIDATED', 'CANCELLED'].includes(plottedSignal.status);
                    const newSignalAlerts = result.newSignals.flatMap((candidate) => {
                        const planKey = getTradePlanKey(candidate);
                        const finalSignal = mergedSignals.find(
                            (signal) => isOpenSignalWorkflow(signal) && getTradePlanKey(signal) === planKey
                        );
                        if (!finalSignal || finalSignal.status !== 'PENDING') return [];
                        const alertKey = `${planKey}:${finalSignal.createdAt}`;
                        if (alertedNewSignalKeys.has(alertKey)) return [];
                        alertedNewSignalKeys.add(alertKey);
                        return [buildTradeAlertEvent('NEW_SIGNAL', finalSignal, state.prices[coin] ?? 0)];
                    });
                    const invalidationAlerts = result.invalidatedSignals.flatMap((candidate) => {
                        const previousSignal = findMatchingSignal(preScanSignals, candidate);
                        const finalSignal = findMatchingSignal(mergedSignals, candidate);
                        if (!finalSignal || finalSignal.status !== 'INVALIDATED') return [];

                        const alertKey = `${getSignalSetupKey(finalSignal)}:${finalSignal.createdAt}`;
                        if (alertedScanInvalidationKeys.has(alertKey)) return [];
                        alertedScanInvalidationKeys.add(alertKey);

                        const urgent = previousSignal?.status === 'APPROVED' ||
                            previousSignal?.status === 'TOUCHED' ||
                            (previousSignal?.status === 'FILLED' && !previousSignal.outcome);
                        return [buildTradeAlertEvent(
                            'INVALIDATED',
                            finalSignal,
                            state.prices[coin] ?? closedCandles.at(-1)?.close ?? 0,
                            Date.now(),
                            { urgent }
                        )];
                    });

                    set({
                        strategyStates: {
                            ...state.strategyStates,
                            [coin]: {
                                ...state.strategyStates[coin],
                                [timeframe]: nextStrategyState,
                            },
                        },
                        signals: mergedSignals,
                        outcomeHistory,
                        plottedSignal: shouldClearPlot ? null : plottedSignal,
                        lastScanTime: state.selectedCoin === coin && state.selectedTimeframe === timeframe
                            ? Date.now()
                            : state.lastScanTime,
                    });
                    get().publishAlerts([...newSignalAlerts, ...invalidationAlerts]);
                } catch (error) {
                    console.error('Scan error:', error);
                }
            },

            runScan: () => {
                const { selectedCoin, selectedTimeframe } = get();
                set({ isScanning: true });
                try {
                    get().scanMarket(selectedCoin, selectedTimeframe);
                } finally {
                    set({ isScanning: false });
                }
            },

            publishAlerts: (alerts) => {
                if (alerts.length === 0) return;

                set((state) => ({
                    alertLog: [...state.alertLog, ...alerts].slice(-100),
                }));
                alerts.forEach(emitTradeAlert);
            },

            markAlertsSeen: () => {
                set((state) => ({
                    alertsLastSeenAt: Math.max(
                        Date.now(),
                        state.alertLog.at(-1)?.occurredAt ?? 0
                    ),
                }));
            },

            acknowledgeEntrySignal: (signalId) => {
                set((state) => state.acknowledgedEntrySignalIds.includes(signalId)
                    ? state
                    : {
                        acknowledgedEntrySignalIds: [
                            ...state.acknowledgedEntrySignalIds,
                            signalId,
                        ].slice(-100),
                    });
            },

            markGuideSeen: () => {
                set((state) => state.hasSeenGuide ? state : { hasSeenGuide: true });
            },

            setShowAllMarkets: (showAllMarkets) => {
                set({ showAllMarkets });
            },

            addSignal: (signal) => {
                set((state) => {
                    const signals = mergeSignals([...state.signals, signal]);
                    return {
                        signals,
                        outcomeHistory: signals === state.signals
                            ? state.outcomeHistory
                            : appendOutcomeHistory(
                                state.outcomeHistory,
                                state.signals,
                                signals
                            ),
                    };
                });
            },

            updateSignalStatus: (signalId, status) => {
                set((state) => {
                    const target = state.signals.find((signal) => signal.id === signalId);
                    if (!target) {
                        return state;
                    }
                    if (status === 'APPROVED' && target.status !== 'PENDING') return state;

                    const updatedTarget: ChainSignal = {
                        ...target,
                        status,
                        sizing: status === 'APPROVED'
                            ? {
                                equity: state.settings.accountEquity,
                                riskPercent: state.settings.riskPercent,
                                leverage: state.settings.leverage,
                            }
                            : target.sizing,
                        closedAt: ['CANCELLED', 'INVALIDATED', 'MISSED'].includes(status)
                            ? Date.now()
                            : target.closedAt,
                    };
                    const targetKey = getSignalSetupKey(target);

                    const coinStates = state.strategyStates[target.coin];
                    const timeframeState = coinStates?.[target.timeframe];
                    const updatedStrategyStates = timeframeState
                        ? {
                            ...state.strategyStates,
                            [target.coin]: {
                                ...coinStates,
                                [target.timeframe]: {
                                    ...timeframeState,
                                    signals: timeframeState.signals.map((signal) =>
                                        getSignalSetupKey(signal) === targetKey ? updatedTarget : signal
                                    ),
                                },
                            },
                        }
                        : state.strategyStates;

                    const signals = state.signals.map((signal) =>
                            getSignalSetupKey(signal) === targetKey ? updatedTarget : signal
                        );

                    return {
                        signals,
                        outcomeHistory: appendOutcomeHistory(
                            state.outcomeHistory,
                            state.signals,
                            signals
                        ),
                        strategyStates: updatedStrategyStates,
                        plottedSignal: state.plottedSignal?.id === signalId
                            ? ['CANCELLED', 'INVALIDATED', 'MISSED'].includes(status)
                                ? null
                                : updatedTarget
                            : state.plottedSignal,
                        selectedSignalId: state.selectedSignalId === signalId && status === 'CANCELLED'
                            ? null
                            : state.selectedSignalId,
                    };
                });
            },

            updateExecutionChecklist: (signalId, item, checked) => {
                set((state) => {
                    const target = state.signals.find((signal) => signal.id === signalId);
                    if (!target) return state;

                    const updatedTarget: ChainSignal = {
                        ...target,
                        executionChecklist: {
                            limitOrderPlaced: false,
                            stopSet: false,
                            takeProfitSet: false,
                            ...target.executionChecklist,
                            [item]: checked,
                        },
                    };
                    const targetKey = getSignalSetupKey(target);
                    const coinStates = state.strategyStates[target.coin];
                    const timeframeState = coinStates?.[target.timeframe];
                    const updatedStrategyStates = timeframeState
                        ? {
                            ...state.strategyStates,
                            [target.coin]: {
                                ...coinStates,
                                [target.timeframe]: {
                                    ...timeframeState,
                                    signals: timeframeState.signals.map((signal) =>
                                        getSignalSetupKey(signal) === targetKey ? updatedTarget : signal
                                    ),
                                },
                            },
                        }
                        : state.strategyStates;

                    return {
                        signals: state.signals.map((signal) =>
                            getSignalSetupKey(signal) === targetKey ? updatedTarget : signal
                        ),
                        strategyStates: updatedStrategyStates,
                        plottedSignal: state.plottedSignal &&
                            getSignalSetupKey(state.plottedSignal) === targetKey
                            ? updatedTarget
                            : state.plottedSignal,
                    };
                });
            },

            removeSignal: (signalId) => {
                set((state) => ({
                    signals: state.signals.filter((s) => s.id !== signalId),
                    plottedSignal: state.plottedSignal?.id === signalId ? null : state.plottedSignal,
                    selectedSignalId: state.selectedSignalId === signalId ? null : state.selectedSignalId,
                }));
            },

            updateSettings: (newSettings) => {
                set((state) => ({
                    settings: { ...state.settings, ...newSettings },
                }));
            },

            setPlottedSignal: (signal) => {
                set({ plottedSignal: signal });
            },

            selectSignal: (signalId) => {
                set({ selectedSignalId: signalId });
            },

            focusSignal: (signalId) => {
                const signal = get().signals.find((item) => item.id === signalId);
                if (!signal) return;
                set({
                    selectedCoin: signal.coin,
                    selectedTimeframe: signal.timeframe,
                    selectedSignalId: signal.id,
                    plottedSignal: signal,
                });
            },

            toggleZones: () => {
                set((state) => ({ showZones: !state.showZones }));
            },

            reset: () => {
                set({
                    candleData: {},
                    strategyStates: {},
                    signals: [],
                    outcomeHistory: [],
                    prices: {},
                    sizeDecimals: {},
                    plottedSignal: null,
                    selectedSignalId: null,
                    isScanning: false,
                    lastScanTime: null,
                    alertLog: [],
                    alertsLastSeenAt: 0,
                    acknowledgedEntrySignalIds: [],
                    hasSeenGuide: false,
                    showAllMarkets: true,
                });
            },
        }),
        {
            name: 'chain-trader-storage',
            storage: createJSONStorage(() => createDebouncedStorage()),
            version: 2,
            migrate: (persistedState) => persistedState ?? {},
            partialize: (state) => ({
                selectedCoin: state.selectedCoin,
                selectedTimeframe: state.selectedTimeframe,
                showZones: state.showZones,
                settings: state.settings,
                alertLog: state.alertLog.slice(-20),
                alertsLastSeenAt: state.alertsLastSeenAt,
                acknowledgedEntrySignalIds: state.acknowledgedEntrySignalIds.slice(-100),
                hasSeenGuide: state.hasSeenGuide,
                outcomeHistory: state.outcomeHistory.slice(-500),
                // Persist user decisions, but never stale candles or unaccepted setups.
                signals: state.signals
                    .filter((signal) => [
                        'APPROVED',
                        'TOUCHED',
                        'FILLED',
                        'MISSED',
                        'CANCELLED',
                        'INVALIDATED',
                    ].includes(signal.status))
                    .sort((first, second) => second.createdAt - first.createdAt)
                    .slice(0, 50),
            }),
            merge: (persistedState, currentState) => {
                const persisted = (persistedState ?? {}) as Partial<TradingState>;
                const signals = persisted.signals ?? currentState.signals;
                const outcomeHistory = appendOutcomeHistory(
                    persisted.outcomeHistory ?? currentState.outcomeHistory,
                    [],
                    signals
                );
                return {
                    ...currentState,
                    ...persisted,
                    signals,
                    outcomeHistory,
                    settings: {
                        ...currentState.settings,
                        ...persisted.settings,
                    },
                };
            },
        }
    )
);
