'use client';

import { useEffect, useRef } from 'react';
import {
    getAllMids,
    getCandleSnapshot,
    getSizeDecimals,
} from '@/lib/api/hyperliquid-client';
import {
    getBackgroundScanTimeframes,
    getEligibleScanBoundary,
    shouldUseFastPricePolling,
} from '@/lib/market/scan-schedule';
import { getTimeframeMs, type Candle, type Timeframe } from '@/lib/trading/types';
import { useTradingStore } from '@/store/trading-store';

interface MarketRuntimeProps {
    enabled: boolean;
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export default function MarketRuntime({ enabled }: MarketRuntimeProps) {
    const availableCoins = useTradingStore((state) => state.availableCoins);
    const selectedTimeframe = useTradingStore((state) => state.selectedTimeframe);
    const scanTimeframes = useTradingStore((state) => state.settings.scanTimeframes);
    const updateCandles = useTradingStore((state) => state.updateCandles);
    const updatePrices = useTradingStore((state) => state.updatePrices);
    const setSizeDecimals = useTradingStore((state) => state.setSizeDecimals);
    const scanMarket = useTradingStore((state) => state.scanMarket);
    const attemptedBoundariesRef = useRef(new Map<string, number>());
    const retryAfterRef = useRef(new Map<string, number>());

    useEffect(() => {
        if (Object.keys(useTradingStore.getState().sizeDecimals).length > 0) return;

        let cancelled = false;
        const controller = new AbortController();
        void getSizeDecimals(controller.signal)
            .then((decimals) => {
                if (!cancelled && Object.keys(decimals).length > 0) {
                    setSizeDecimals(decimals);
                }
            })
            .catch(() => {
                // Quantity formatting falls back safely when metadata is unavailable.
            });

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [setSizeDecimals]);

    useEffect(() => {
        if (!enabled) return;

        let cancelled = false;
        let sweepRunning = false;
        let sweepQueued = false;
        let lastRequestStartedAt = 0;
        let activeController: AbortController | null = null;
        const attemptedBoundaries = attemptedBoundariesRef.current;
        const retryAfter = retryAfterRef.current;

        const rateLimitedSnapshot = async (
            coin: string,
            timeframe: Timeframe,
            now: number
        ): Promise<Candle[]> => {
            const waitMs = Math.max(0, 300 - (Date.now() - lastRequestStartedAt));
            if (waitMs > 0) await delay(waitMs);
            if (cancelled) throw new DOMException('Stopped', 'AbortError');

            activeController = new AbortController();
            lastRequestStartedAt = Date.now();
            return getCandleSnapshot(
                coin,
                timeframe,
                now - (200 * getTimeframeMs(timeframe)),
                now,
                activeController.signal
            );
        };

        // Sweeps keep running while the tab is hidden: finding signals in the
        // background is what the desktop notifications and sounds exist for.
        // Hidden tabs throttle timers, so a sweep may start up to a minute late.
        const runDueSweep = async () => {
            if (cancelled) return;
            if (sweepRunning) {
                sweepQueued = true;
                return;
            }

            sweepRunning = true;
            const now = Date.now();
            const timeframes = getBackgroundScanTimeframes(selectedTimeframe, scanTimeframes);
            const selectedCoin = useTradingStore.getState().selectedCoin;
            const jobs = availableCoins.flatMap((coin) => timeframes.map((timeframe) => ({ coin, timeframe })))
                .sort((first, second) => {
                    const firstSelected = first.coin === selectedCoin && first.timeframe === selectedTimeframe ? 0 : 1;
                    const secondSelected = second.coin === selectedCoin && second.timeframe === selectedTimeframe ? 0 : 1;
                    return firstSelected - secondSelected;
                });
            const snapshotCache = new Map<string, Candle[]>();

            try {
                for (const { coin, timeframe } of jobs) {
                    if (cancelled) break;
                    const key = `${coin}:${timeframe}`;
                    const boundary = getEligibleScanBoundary(now, timeframe);
                    if (attemptedBoundaries.get(key) === boundary) continue;
                    if (now < (retryAfter.get(key) ?? 0)) continue;

                    try {
                        const loaded = useTradingStore.getState().candleData[coin]?.[timeframe];
                        const canReuseFreshInitialData = Boolean(
                            loaded?.candles.length && now - loaded.lastUpdate < 10000
                        );
                        let candles = canReuseFreshInitialData ? loaded.candles : snapshotCache.get(key);
                        if (!candles) {
                            candles = await rateLimitedSnapshot(coin, timeframe, now);
                            snapshotCache.set(key, candles);
                        }
                        updateCandles(coin, timeframe, candles);

                        if (timeframe === '5m' || timeframe === '15m') {
                            const higherKey = `${coin}:1h`;
                            let higherCandles = snapshotCache.get(higherKey);
                            if (!higherCandles) {
                                higherCandles = await rateLimitedSnapshot(coin, '1h', now);
                                snapshotCache.set(higherKey, higherCandles);
                            }
                            updateCandles(coin, '1h', higherCandles);
                        }

                        scanMarket(coin, timeframe);
                        attemptedBoundaries.set(key, boundary);
                        retryAfter.delete(key);
                    } catch (error) {
                        if (error instanceof DOMException && error.name === 'AbortError') {
                            // An interrupted request did not complete this boundary; retry it.
                            attemptedBoundaries.delete(key);
                        } else {
                            retryAfter.set(key, Date.now() + 30_000);
                            console.error(`Background scan failed for ${key}:`, error);
                        }
                    } finally {
                        activeController = null;
                    }
                }
            } finally {
                sweepRunning = false;
                if (sweepQueued && !cancelled) {
                    sweepQueued = false;
                    void runDueSweep();
                }
            }
        };

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') void runDueSweep();
        };

        const interval = setInterval(() => void runDueSweep(), 1000);
        document.addEventListener('visibilitychange', handleVisibility);
        void runDueSweep();

        return () => {
            cancelled = true;
            activeController?.abort();
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [availableCoins, enabled, scanMarket, scanTimeframes, selectedTimeframe, updateCandles]);

    useEffect(() => {
        if (!enabled) return;

        let cancelled = false;
        let timeout: ReturnType<typeof setTimeout> | null = null;
        let inFlight = false;
        let refreshQueued = false;
        let controller: AbortController | null = null;

        const scheduleNext = () => {
            if (cancelled) return;
            const state = useTradingStore.getState();
            const milliseconds = shouldUseFastPricePolling(state.signals, state.prices) ? 5000 : 15000;
            timeout = setTimeout(() => void pollPrices(), milliseconds);
        };

        const pollPrices = async () => {
            if (cancelled) return;
            if (inFlight) {
                refreshQueued = true;
                return;
            }

            inFlight = true;
            controller = new AbortController();
            try {
                const mids = await getAllMids(controller.signal);
                if (!cancelled) updatePrices(mids);
            } catch (error) {
                if (!(error instanceof DOMException && error.name === 'AbortError')) {
                    console.error('Failed to update prices:', error);
                }
            } finally {
                inFlight = false;
                controller = null;
                if (refreshQueued) {
                    refreshQueued = false;
                    void pollPrices();
                } else {
                    scheduleNext();
                }
            }
        };

        const handleFocus = () => {
            if (timeout) clearTimeout(timeout);
            void pollPrices();
        };

        scheduleNext();
        window.addEventListener('focus', handleFocus);

        return () => {
            cancelled = true;
            controller?.abort();
            if (timeout) clearTimeout(timeout);
            window.removeEventListener('focus', handleFocus);
        };
    }, [enabled, updatePrices]);

    return null;
}
