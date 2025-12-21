'use client';

import { useTradingStore } from '@/store/trading-store';
import { ChainSignal } from '@/lib/trading/types';
import { calculatePositionSize, formatUSD, formatPercent } from '@/lib/trading/risk-calculator';

interface SignalCardProps {
    signal: ChainSignal;
    currentPrice: number;
}

export default function SignalCard({ signal, currentPrice }: SignalCardProps) {
    const { settings, updateSignalStatus } = useTradingStore();

    const handleApprove = () => {
        // TODO: Open trade modal for final confirmation
        updateSignalStatus(signal.id, 'APPROVED');
    };

    const handleDismiss = () => {
        updateSignalStatus(signal.id, 'CANCELLED');
    };

    // Calculate position size
    const positionDetails = calculatePositionSize({
        equity: 10000, // TODO: Get from actual account
        riskPercent: settings.riskPercent,
        leverage: settings.leverage,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
    });

    const isLong = signal.direction === 'LONG';
    const distanceToEntry = ((signal.entryPrice - currentPrice) / currentPrice) * 100;

    return (
        <div className={`card animate-fade-in ${isLong ? 'signal-long' : 'signal-short'}`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <span className={`badge ${isLong ? 'badge-long' : 'badge-short'}`}>
                        {signal.direction}
                    </span>
                    <span className="text-sm font-semibold">{signal.coin}</span>
                    <span className="text-xs text-[var(--text-muted)]">{signal.timeframe}</span>
                </div>
                {signal.hasRsiDivergence && (
                    <span className="badge badge-divergence">
                        RSI Div
                    </span>
                )}
            </div>

            {/* Price Levels */}
            <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="stat">
                    <span className="stat-label">Entry</span>
                    <span className="stat-value text-sm">
                        ${signal.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                </div>
                <div className="stat">
                    <span className="stat-label">Stop Loss</span>
                    <span className="stat-value text-sm text-[var(--short-red)]">
                        ${signal.stopLoss.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                </div>
                <div className="stat">
                    <span className="stat-label">Take Profit</span>
                    <span className="stat-value text-sm text-[var(--long-green)]">
                        ${signal.takeProfit.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                </div>
            </div>

            {/* Stats Row */}
            <div className="flex items-center justify-between text-sm mb-4 py-3 border-t border-b border-[var(--card-border)]">
                <div>
                    <span className="text-[var(--text-muted)]">R:R </span>
                    <span className={`font-semibold ${signal.riskRewardRatio >= 2 ? 'text-[var(--long-green)]' : ''}`}>
                        1:{signal.riskRewardRatio.toFixed(1)}
                    </span>
                </div>
                <div>
                    <span className="text-[var(--text-muted)]">Confidence </span>
                    <span className="font-semibold">{signal.confidence.toFixed(0)}%</span>
                </div>
                <div>
                    <span className="text-[var(--text-muted)]">Distance </span>
                    <span className={`font-semibold ${distanceToEntry > 0 ? 'text-[var(--long-green)]' : 'text-[var(--short-red)]'}`}>
                        {distanceToEntry > 0 ? '+' : ''}{distanceToEntry.toFixed(2)}%
                    </span>
                </div>
            </div>

            {/* Position Size Preview */}
            <div className="bg-[var(--background)] rounded-lg p-3 mb-4">
                <div className="flex items-center justify-between text-sm">
                    <span className="text-[var(--text-muted)]">Position Size</span>
                    <span className="font-mono">{formatUSD(positionDetails.notionalValue)}</span>
                </div>
                <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-[var(--text-muted)]">Risk Amount</span>
                    <span className="font-mono text-[var(--short-red)]">{formatUSD(positionDetails.riskAmount)}</span>
                </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
                <button
                    onClick={handleApprove}
                    className="btn btn-success flex-1"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12l5 5L20 7" />
                    </svg>
                    Approve
                </button>
                <button
                    onClick={handleDismiss}
                    className="btn btn-outline flex-1"
                >
                    Dismiss
                </button>
            </div>
        </div>
    );
}
