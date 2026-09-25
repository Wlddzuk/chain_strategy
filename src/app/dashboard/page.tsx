'use client';

import { useEffect, useRef, useState } from 'react';
import ActiveSignalsCard from '@/components/active-signals-card';
import AlertToastHost from '@/components/alert-toast-host';
import ChartPanel from '@/components/chart-panel';
import { DashboardHeader } from '@/components/dashboard-header';
import CurrentPriceCard from '@/components/current-price-card';
import MarketRuntime from '@/components/market-runtime';
import { NowBar } from '@/components/now-bar';
import SettingsPanel from '@/components/settings-panel';
import SignalsPanel from '@/components/signals-panel';
import TradingContextCard from '@/components/trading-context-card';
import TradingAlertRuntime from '@/components/trading-alert-runtime';
import { getAllMids, getCandleSnapshot, getEquity } from '@/lib/api/hyperliquid-client';
import {
    type MarketConnectionStatus,
    subscribeToHyperliquidCandles,
} from '@/lib/api/hyperliquid-ws';
import type { Candle } from '@/lib/trading/types';
import { useTradingStore } from '@/store/trading-store';

export default function Dashboard() {
    const selectedCoin = useTradingStore((state) => state.selectedCoin);
    const selectedTimeframe = useTradingStore((state) => state.selectedTimeframe);
    const walletAddress = useTradingStore((state) => state.settings.walletAddress);
    const updateCandles = useTradingStore((state) => state.updateCandles);
    const appendCandle = useTradingStore((state) => state.appendCandle);
    const updatePrice = useTradingStore((state) => state.updatePrice);
    const updatePrices = useTradingStore((state) => state.updatePrices);
    const updateSettings = useTradingStore((state) => state.updateSettings);
    const runScan = useTradingStore((state) => state.runScan);

    const [isLoading, setIsLoading] = useState(true);
    const [showSettings, setShowSettings] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<MarketConnectionStatus>('CONNECTING');
    const lastLiveUpdateRef = useRef<number | null>(null);
    const candleBufferRef = useRef<Map<number, { candle: Candle; isClosed: boolean }>>(new Map());
    const candleFlushFrameRef = useRef<number | null>(null);

    useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();
        let retryTimer: ReturnType<typeof setTimeout> | null = null;

        async function fetchCandles() {
            setIsLoading(true);
            setError(null);

            try {
                const now = Date.now();
                const intervalMs = {
                    '5m': 5 * 60 * 1000,
                    '15m': 15 * 60 * 1000,
                    '1h': 60 * 60 * 1000,
                    '4h': 4 * 60 * 60 * 1000,
                }[selectedTimeframe];
                const candles = await getCandleSnapshot(
                    selectedCoin,
                    selectedTimeframe,
                    now - (200 * intervalMs),
                    now,
                    controller.signal
                );

                if (candles.length === 0) throw new Error('No verified candles returned');

                if (cancelled) return;
                updateCandles(selectedCoin, selectedTimeframe, candles);

                if (selectedTimeframe === '15m' || selectedTimeframe === '5m') {
                    const higherTimeframeCandles = await getCandleSnapshot(
                        selectedCoin,
                        '1h',
                        now - (200 * 60 * 60 * 1000),
                        now,
                        controller.signal
                    );
                    if (!cancelled) updateCandles(selectedCoin, '1h', higherTimeframeCandles);
                }

                const mids = await getAllMids(controller.signal);
                if (cancelled) return;
                updatePrices(mids);
                runScan();
            } catch (caughtError) {
                if (cancelled || (caughtError instanceof DOMException && caughtError.name === 'AbortError')) return;
                console.error('Failed to fetch candles:', caughtError);
                setError('Hyperliquid market data is unavailable. No simulated data has been substituted.');
                setConnectionStatus('ERROR');
                retryTimer = setTimeout(() => void fetchCandles(), 15_000);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        }

        void fetchCandles();
        return () => {
            cancelled = true;
            if (retryTimer) clearTimeout(retryTimer);
            controller.abort();
        };
    }, [selectedCoin, selectedTimeframe, runScan, updateCandles, updatePrices]);

    useEffect(() => {
        if (isLoading || error) return;

        setConnectionStatus('CONNECTING');
        lastLiveUpdateRef.current = null;
        const bufferedCandles = candleBufferRef.current;
        bufferedCandles.clear();

        const flushCandles = () => {
            candleFlushFrameRef.current = null;
            const pending = Array.from(bufferedCandles.values())
                .sort((first, second) => first.candle.time - second.candle.time);
            bufferedCandles.clear();

            for (const { candle, isClosed } of pending) {
                appendCandle(selectedCoin, selectedTimeframe, candle, isClosed);
            }

            const latest = pending[pending.length - 1];
            if (latest) updatePrice(selectedCoin, latest.candle.close);
        };

        const unsubscribe = subscribeToHyperliquidCandles({
            coin: selectedCoin,
            interval: selectedTimeframe,
            onCandle: (candle, isClosed) => {
                const existing = bufferedCandles.get(candle.time);
                bufferedCandles.set(candle.time, {
                    candle,
                    isClosed: Boolean(existing?.isClosed || isClosed),
                });
                lastLiveUpdateRef.current = Date.now();
                if (candleFlushFrameRef.current === null) {
                    candleFlushFrameRef.current = requestAnimationFrame(flushCandles);
                }
            },
            onStatus: setConnectionStatus,
        });

        return () => {
            unsubscribe();
            if (candleFlushFrameRef.current !== null) {
                cancelAnimationFrame(candleFlushFrameRef.current);
                candleFlushFrameRef.current = null;
            }
            bufferedCandles.clear();
        };
    }, [appendCandle, error, isLoading, selectedCoin, selectedTimeframe, updatePrice]);

    useEffect(() => {
        if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) return;
        let cancelled = false;
        void getEquity(walletAddress)
            .then((accountEquity) => {
                if (!cancelled && Number.isFinite(accountEquity) && accountEquity > 0) {
                    updateSettings({ accountEquity });
                }
            })
            .catch(() => {
                // Keep the manual balance when the public account lookup fails.
            });
        return () => {
            cancelled = true;
        };
    }, [updateSettings, walletAddress]);

    return (
        <div className="min-h-screen bg-[var(--background)]">
            <TradingAlertRuntime />
            <AlertToastHost />
            <MarketRuntime enabled={!isLoading && !error} />

            <DashboardHeader
                settingsOpen={showSettings}
                onSettingsToggle={() => setShowSettings((visible) => !visible)}
            />

            <NowBar />

            <main className="max-w-[1800px] mx-auto px-4 sm:px-6 py-4 sm:py-6">
                <section
                    aria-label="Market summary"
                    className="mb-4 grid grid-cols-1 gap-3 sm:mb-6 sm:grid-cols-2 sm:gap-4 lg:grid-cols-12"
                >
                    <CurrentPriceCard className="lg:col-span-5" />
                    <ActiveSignalsCard className="lg:col-span-3" />
                    <TradingContextCard
                        className="sm:col-span-2 lg:col-span-4"
                        connectionStatus={connectionStatus}
                        lastLiveUpdateRef={lastLiveUpdateRef}
                    />
                </section>

                <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_420px]">
                    <ChartPanel isLoading={isLoading} error={error} />
                    <SignalsPanel />
                </div>
            </main>

            {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
        </div>
    );
}
