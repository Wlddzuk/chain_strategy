'use client';

import { useEffect, useState } from 'react';
import { useTradingStore } from '@/store/trading-store';
import { getCandleSnapshot, getAllMids } from '@/lib/api/hyperliquid-client';
import Chart from '@/components/chart';
import SignalCard from '@/components/signal-card';
import TimeframeToggle from '@/components/timeframe-toggle';
import CoinSelector from '@/components/coin-selector';
import SettingsPanel from '@/components/settings-panel';

export default function Dashboard() {
    const {
        selectedCoin,
        selectedTimeframe,
        candleData,
        strategyStates,
        signals,
        prices,
        settings,
        isScanning,
        lastScanTime,
        updateCandles,
        updatePrices,
        runScan,
    } = useTradingStore();

    const [isLoading, setIsLoading] = useState(true);
    const [showSettings, setShowSettings] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch initial candle data
    useEffect(() => {
        async function fetchCandles() {
            setIsLoading(true);
            setError(null);

            try {
                const now = Date.now();
                const intervalMs = {
                    '15m': 15 * 60 * 1000,
                    '1h': 60 * 60 * 1000,
                    '4h': 4 * 60 * 60 * 1000,
                }[selectedTimeframe];

                // Fetch last 200 candles
                const startTime = now - (200 * intervalMs);

                const candles = await getCandleSnapshot(
                    selectedCoin,
                    selectedTimeframe,
                    startTime,
                    now
                );

                updateCandles(selectedCoin, selectedTimeframe, candles);

                // Fetch current prices
                const mids = await getAllMids();
                updatePrices(mids);

                // Run initial scan
                runScan();
            } catch (err) {
                console.error('Failed to fetch candles:', err);
                setError('Failed to load market data. Please try again.');
            } finally {
                setIsLoading(false);
            }
        }

        fetchCandles();
    }, [selectedCoin, selectedTimeframe]);

    // Auto-refresh prices every 5 seconds
    useEffect(() => {
        const interval = setInterval(async () => {
            try {
                const mids = await getAllMids();
                updatePrices(mids);
            } catch (err) {
                console.error('Failed to update prices:', err);
            }
        }, 5000);

        return () => clearInterval(interval);
    }, []);

    const currentPrice = prices[selectedCoin] || 0;
    const currentCandles = candleData[selectedCoin]?.[selectedTimeframe]?.candles || [];
    const currentZones = strategyStates[selectedCoin]?.[selectedTimeframe]?.zones || [];
    const pendingSignals = signals.filter(s => s.status === 'PENDING' && s.coin === selectedCoin);

    return (
        <div className="min-h-screen bg-[var(--background)]">
            {/* Header */}
            <header className="border-b border-[var(--card-border)] bg-[var(--card-bg)]">
                <div className="max-w-[1800px] mx-auto px-6 py-4">
                    <div className="flex items-center justify-between">
                        {/* Logo & Title */}
                        <div className="flex items-center gap-4">
                            <h1 className="text-xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                                Chain Trader
                            </h1>
                            <div className="h-6 w-px bg-[var(--card-border)]" />
                            <span className="text-sm text-[var(--text-muted)]">
                                Supply & Demand Strategy
                            </span>
                        </div>

                        {/* Controls */}
                        <div className="flex items-center gap-4">
                            <CoinSelector />
                            <TimeframeToggle />
                            <button
                                onClick={() => setShowSettings(!showSettings)}
                                className="btn btn-outline"
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                                    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                                </svg>
                                Settings
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-[1800px] mx-auto px-6 py-6">
                {/* Stats Bar */}
                <div className="grid grid-cols-5 gap-4 mb-6">
                    <div className="card">
                        <div className="stat">
                            <span className="stat-label">Current Price</span>
                            <span className="stat-value">
                                ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                        </div>
                    </div>

                    <div className="card">
                        <div className="stat">
                            <span className="stat-label">Active Signals</span>
                            <span className="stat-value">{pendingSignals.length}</span>
                        </div>
                    </div>

                    <div className="card">
                        <div className="stat">
                            <span className="stat-label">Risk per Trade</span>
                            <span className="stat-value">{settings.riskPercent}%</span>
                        </div>
                    </div>

                    <div className="card">
                        <div className="stat">
                            <span className="stat-label">Leverage</span>
                            <span className="stat-value">{settings.leverage}x</span>
                        </div>
                    </div>

                    <div className="card">
                        <div className="stat">
                            <span className="stat-label">Status</span>
                            <div className="flex items-center gap-2">
                                {isScanning ? (
                                    <>
                                        <div className="animate-pulse w-2 h-2 rounded-full bg-[var(--warning)]" />
                                        <span className="stat-value text-sm">Scanning...</span>
                                    </>
                                ) : (
                                    <>
                                        <div className="live-dot" />
                                        <span className="stat-value text-sm">Live</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Main Grid */}
                <div className="grid grid-cols-[1fr_380px] gap-6">
                    {/* Chart Panel */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <h2 className="text-lg font-semibold">{selectedCoin}/USDT</h2>
                                <span className="badge badge-pending">{selectedTimeframe}</span>
                            </div>
                            <button
                                onClick={runScan}
                                disabled={isScanning || isLoading}
                                className="btn btn-primary"
                            >
                                {isScanning ? (
                                    <>
                                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                        Scanning...
                                    </>
                                ) : (
                                    <>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                        </svg>
                                        Scan Now
                                    </>
                                )}
                            </button>
                        </div>

                        {error ? (
                            <div className="card border-[var(--error)] bg-[var(--short-red-dim)]">
                                <p className="text-[var(--error)]">{error}</p>
                                <button onClick={() => window.location.reload()} className="btn btn-outline mt-4">
                                    Retry
                                </button>
                            </div>
                        ) : (
                            <Chart candles={currentCandles} zones={currentZones} isLoading={isLoading} />
                        )}

                        {lastScanTime && (
                            <p className="text-sm text-[var(--text-muted)]">
                                Last scan: {new Date(lastScanTime).toLocaleTimeString()}
                            </p>
                        )}
                    </div>

                    {/* Signals Panel */}
                    <div className="space-y-4">
                        <h2 className="text-lg font-semibold">Trade Signals</h2>

                        {pendingSignals.length === 0 ? (
                            <div className="card">
                                <div className="text-center py-8">
                                    <svg className="w-12 h-12 mx-auto mb-4 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                        <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                    </svg>
                                    <p className="text-[var(--text-muted)]">No signals detected</p>
                                    <p className="text-sm text-[var(--text-muted)] mt-2">
                                        Waiting for Chain Strategy setups...
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {pendingSignals.map((signal) => (
                                    <SignalCard key={signal.id} signal={signal} currentPrice={currentPrice} />
                                ))}
                            </div>
                        )}

                        {/* Trade History */}
                        <div className="mt-6">
                            <h3 className="text-sm font-semibold text-[var(--text-muted)] mb-3">
                                Recent Activity
                            </h3>
                            <div className="card">
                                <p className="text-sm text-[var(--text-muted)] text-center py-4">
                                    No trades yet
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            {/* Settings Modal */}
            {showSettings && (
                <SettingsPanel onClose={() => setShowSettings(false)} />
            )}
        </div>
    );
}
