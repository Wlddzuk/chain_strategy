// Trading Store - Zustand state management
// Manages candles, zones, signals, settings, and WebSocket connections

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Candle, Zone, ChainSignal } from '../lib/trading/types';
import { ChainStrategyState, scanForSignals } from '../lib/trading/chain-strategy';

export type Timeframe = '15m' | '1h' | '4h';

export interface TradingSettings {
    riskPercent: number;
    leverage: number;
    walletAddress: string;
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

    // Current prices
    prices: Record<string, number>;

    // User settings
    settings: TradingSettings;

    // UI state
    isScanning: boolean;
    lastScanTime: number | null;

    // Actions
    setSelectedCoin: (coin: string) => void;
    setSelectedTimeframe: (tf: Timeframe) => void;
    setAvailableCoins: (coins: string[]) => void;

    updateCandles: (coin: string, timeframe: Timeframe, candles: Candle[]) => void;
    appendCandle: (coin: string, timeframe: Timeframe, candle: Candle, isClosed: boolean) => void;

    updatePrice: (coin: string, price: number) => void;
    updatePrices: (prices: Record<string, number>) => void;

    runScan: () => void;

    addSignal: (signal: ChainSignal) => void;
    updateSignalStatus: (signalId: string, status: ChainSignal['status']) => void;
    removeSignal: (signalId: string) => void;

    updateSettings: (settings: Partial<TradingSettings>) => void;

    reset: () => void;
}

const initialSettings: TradingSettings = {
    riskPercent: 1,
    leverage: 10,
    walletAddress: '',
};

const defaultCoins = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'AVAX', 'LINK', 'ARB'];

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
            prices: {},
            settings: initialSettings,
            isScanning: false,
            lastScanTime: null,

            // Actions
            setSelectedCoin: (coin) => set({ selectedCoin: coin }),

            setSelectedTimeframe: (tf) => set({ selectedTimeframe: tf }),

            setAvailableCoins: (coins) => set({ availableCoins: coins }),

            updateCandles: (coin, timeframe, candles) => {
                set((state) => ({
                    candleData: {
                        ...state.candleData,
                        [coin]: {
                            ...state.candleData[coin],
                            [timeframe]: {
                                candles,
                                lastUpdate: Date.now(),
                                isLive: true,
                            },
                        },
                    },
                }));
            },

            appendCandle: (coin, timeframe, candle, isClosed) => {
                set((state) => {
                    const existing = state.candleData[coin]?.[timeframe]?.candles || [];
                    let updated: Candle[];

                    if (!isClosed && existing.length > 0) {
                        // Update the last candle (it's still forming)
                        updated = [...existing.slice(0, -1), candle];
                    } else if (isClosed) {
                        // Add new closed candle
                        const lastCandle = existing[existing.length - 1];
                        if (lastCandle && lastCandle.time === candle.time) {
                            // Replace the last candle with closed version
                            updated = [...existing.slice(0, -1), candle];
                        } else {
                            // Append new candle
                            updated = [...existing, candle];
                        }
                    } else {
                        updated = [...existing, candle];
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

                // Auto-scan on closed candles
                if (isClosed) {
                    get().runScan();
                }
            },

            updatePrice: (coin, price) => {
                set((state) => ({
                    prices: { ...state.prices, [coin]: price },
                }));
            },

            updatePrices: (prices) => {
                set((state) => ({
                    prices: { ...state.prices, ...prices },
                }));
            },

            runScan: () => {
                const state = get();
                const { selectedCoin, selectedTimeframe, candleData, strategyStates } = state;

                const coinData = candleData[selectedCoin]?.[selectedTimeframe];
                if (!coinData?.candles.length) return;

                set({ isScanning: true });

                try {
                    const existingState = strategyStates[selectedCoin]?.[selectedTimeframe];
                    const result = scanForSignals(
                        coinData.candles,
                        selectedCoin,
                        selectedTimeframe,
                        existingState
                    );

                    set((state) => ({
                        strategyStates: {
                            ...state.strategyStates,
                            [selectedCoin]: {
                                ...state.strategyStates[selectedCoin],
                                [selectedTimeframe]: result.state,
                            },
                        },
                        signals: [
                            ...state.signals.filter(s =>
                                !(s.coin === selectedCoin && s.timeframe === selectedTimeframe && s.status === 'PENDING')
                            ),
                            ...result.newSignals,
                        ],
                        isScanning: false,
                        lastScanTime: Date.now(),
                    }));
                } catch (error) {
                    console.error('Scan error:', error);
                    set({ isScanning: false });
                }
            },

            addSignal: (signal) => {
                set((state) => ({
                    signals: [...state.signals, signal],
                }));
            },

            updateSignalStatus: (signalId, status) => {
                set((state) => ({
                    signals: state.signals.map((s) =>
                        s.id === signalId ? { ...s, status } : s
                    ),
                }));
            },

            removeSignal: (signalId) => {
                set((state) => ({
                    signals: state.signals.filter((s) => s.id !== signalId),
                }));
            },

            updateSettings: (newSettings) => {
                set((state) => ({
                    settings: { ...state.settings, ...newSettings },
                }));
            },

            reset: () => {
                set({
                    candleData: {},
                    strategyStates: {},
                    signals: [],
                    prices: {},
                    isScanning: false,
                    lastScanTime: null,
                });
            },
        }),
        {
            name: 'chain-trader-storage',
            partialize: (state) => ({
                selectedCoin: state.selectedCoin,
                selectedTimeframe: state.selectedTimeframe,
                settings: state.settings,
                // Don't persist candles or signals - they're fetched fresh
            }),
        }
    )
);
