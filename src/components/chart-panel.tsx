'use client';

import { useState } from 'react';
import Chart from '@/components/chart';
import { CandleCloseCountdown } from '@/components/candle-close-countdown';
import type { Candle, Zone } from '@/lib/trading/types';
import { useTradingStore } from '@/store/trading-store';

interface ChartPanelProps {
    isLoading: boolean;
    error: string | null;
}

const EMPTY_CANDLES: Candle[] = [];
const EMPTY_ZONES: Zone[] = [];

export default function ChartPanel({ isLoading, error }: ChartPanelProps) {
    const [showRsi, setShowRsi] = useState(false);
    const [showBollinger, setShowBollinger] = useState(false);
    const selectedCoin = useTradingStore((state) => state.selectedCoin);
    const selectedTimeframe = useTradingStore((state) => state.selectedTimeframe);
    const candles = useTradingStore(
        (state) => state.candleData[selectedCoin]?.[selectedTimeframe]?.candles ?? EMPTY_CANDLES
    );
    const zones = useTradingStore(
        (state) => state.strategyStates[selectedCoin]?.[selectedTimeframe]?.zones ?? EMPTY_ZONES
    );
    const isScanning = useTradingStore((state) => state.isScanning);
    const lastScanTime = useTradingStore((state) => state.lastScanTime);
    const runScan = useTradingStore((state) => state.runScan);

    return (
        <div className="min-w-0 space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold">{selectedCoin}/USD</h2>
                    <span className="badge badge-pending">{selectedTimeframe}</span>
                    <CandleCloseCountdown timeframe={selectedTimeframe} />
                    <span className="hidden sm:inline text-xs text-[var(--text-muted)]">Hyperliquid perpetual</span>
                </div>
                <button
                    type="button"
                    onClick={runScan}
                    disabled={isScanning || isLoading}
                    className="btn btn-primary"
                >
                    {isScanning ? (
                        <>
                            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Scanning...
                        </>
                    ) : (
                        <>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
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
                    <button type="button" onClick={() => window.location.reload()} className="btn btn-outline mt-4">
                        Retry
                    </button>
                </div>
            ) : (
                <Chart
                    key={`${selectedCoin}-${selectedTimeframe}`}
                    candles={candles}
                    zones={zones}
                    isLoading={isLoading}
                    showRsi={showRsi}
                    showBollinger={showBollinger}
                    onToggleRsi={() => setShowRsi((visible) => !visible)}
                    onToggleBollinger={() => setShowBollinger((visible) => !visible)}
                />
            )}

            {lastScanTime && (
                <p className="text-sm text-[var(--text-muted)]">
                    Last scan: {new Date(lastScanTime).toLocaleTimeString()}
                </p>
            )}
        </div>
    );
}
