'use client';

import { ChevronRight } from 'lucide-react';
import { useTradingStore } from '@/store/trading-store';
import CopyButton from '@/components/copy-button';
import SignalStatusStrip from '@/components/signal-status-strip';
import { getMoveToEntryPercent } from '@/lib/trading/entry-distance';
import type { ChainSignal } from '@/lib/trading/types';
import { calculatePositionSize, formatUSD } from '@/lib/trading/risk-calculator';
import { focusStrategyChart } from '@/lib/ui/focus-chart';
import { getRoundedQuantity } from '@/lib/ui/format-quantity';
import { formatPrice } from '@/lib/ui/format-price';
import { getOpenPlanButtonState } from '@/lib/ui/trade-plan-actions';
import {
    calculateNetRiskReward,
    isPositionSizingUnsafe,
} from '@/lib/ui/trade-metrics';
import {
    formatRelativeAge,
    getEntryGuidance,
    getSignalStatusBadgeClass,
    getSignalStatusLabel,
} from '@/lib/ui/signal-display';

interface SignalCardProps {
    signal: ChainSignal;
    now: number;
}

export default function SignalCard({ signal, now }: SignalCardProps) {
    const accountEquity = useTradingStore((state) => signal.sizing?.equity ?? state.settings.accountEquity);
    const riskPercent = useTradingStore((state) => signal.sizing?.riskPercent ?? state.settings.riskPercent);
    const leverage = useTradingStore((state) => signal.sizing?.leverage ?? state.settings.leverage);
    const feePercentPerSide = useTradingStore((state) => state.settings.feePercentPerSide);
    const farFromEntryPercent = useTradingStore((state) => state.settings.farFromEntryPercent);
    const approachThresholdPercent = useTradingStore((state) => state.settings.approachThresholdPercent);
    const sizeDecimals = useTradingStore((state) => state.sizeDecimals[signal.coin]);
    // A once-per-minute parent tick refreshes this display. Lifecycle checks still
    // run on every price update inside the store without re-rendering the card.
    const currentPrice = useTradingStore.getState().prices[signal.coin] ?? 0;
    const updateSignalStatus = useTradingStore((state) => state.updateSignalStatus);
    const plottedSignal = useTradingStore((state) => state.plottedSignal);
    const selectedSignalId = useTradingStore((state) => state.selectedSignalId);
    const setPlottedSignal = useTradingStore((state) => state.setPlottedSignal);
    const focusSignal = useTradingStore((state) => state.focusSignal);
    const setSelectedCoin = useTradingStore((state) => state.setSelectedCoin);
    const setSelectedTimeframe = useTradingStore((state) => state.setSelectedTimeframe);

    const isPlotted = plottedSignal?.id === signal.id;
    const isSelected = selectedSignalId === signal.id;
    const isLong = signal.direction === 'LONG';
    const canOpenPlan = signal.status === 'PENDING';
    const canDismiss = signal.status === 'PENDING' || signal.status === 'APPROVED' || signal.status === 'TOUCHED';
    const moveToEntryPercent = getMoveToEntryPercent(
        currentPrice,
        signal.entryPrice
    );
    const distanceToEntry = Number.isFinite(moveToEntryPercent)
        ? moveToEntryPercent
        : null;

    const positionDetails = calculatePositionSize({
        equity: accountEquity,
        riskPercent,
        leverage,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
    });
    const netRiskReward = calculateNetRiskReward(
        signal.entryPrice,
        signal.stopLoss,
        signal.takeProfit,
        feePercentPerSide
    );
    const absoluteDistanceToEntry = Math.abs(moveToEntryPercent);
    const isFarFromEntry = signal.status !== 'TOUCHED' &&
        Number.isFinite(absoluteDistanceToEntry) &&
        absoluteDistanceToEntry > farFromEntryPercent;
    const hasUnsafeSizing = isPositionSizingUnsafe(
        positionDetails,
        accountEquity,
        leverage
    );
    const quantity = getRoundedQuantity(positionDetails.positionSize, sizeDecimals);
    const statusLabel = getSignalStatusLabel(signal, now);
    const openPlanButton = getOpenPlanButtonState(isSelected);

    const handleOpenTicket = () => {
        focusSignal(signal.id);
    };

    const handleDismiss = () => {
        updateSignalStatus(signal.id, 'CANCELLED');
    };

    const handlePlot = () => {
        if (isPlotted) {
            setPlottedSignal(null);
            return;
        }
        setSelectedCoin(signal.coin);
        setSelectedTimeframe(signal.timeframe);
        setPlottedSignal(signal);
        focusStrategyChart();
    };

    return (
        <article
            className={`card animate-fade-in transition-opacity ${isLong ? 'signal-long' : 'signal-short'} ${isSelected ? 'ring-1 ring-[var(--accent)]' : ''} ${isFarFromEntry ? 'opacity-[0.65]' : ''}`}
            aria-label={`${signal.direction} ${signal.coin} ${signal.timeframe} signal`}
        >
            <SignalStatusStrip
                signal={signal}
                currentPrice={currentPrice}
                approachThresholdPercent={approachThresholdPercent}
                now={now}
            />

            <header className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className={`badge shrink-0 ${isLong ? 'badge-long' : 'badge-short'}`}>
                            {signal.direction}
                        </span>
                        <h3 className="truncate text-base font-semibold tracking-tight">
                            {signal.coin} <span className="font-medium text-[var(--text-muted)]">{signal.timeframe}</span>
                        </h3>
                    </div>
                    <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                        Fired {formatRelativeAge(signal.createdAt, now)}
                        {signal.higherTimeframe && <> · HTF {signal.higherTimeframe}</>}
                    </p>
                </div>
                <div className="flex max-w-[45%] flex-wrap justify-end gap-1.5">
                    {statusLabel && (
                        <span className={`badge ${getSignalStatusBadgeClass(signal)}`}>
                            {statusLabel}
                        </span>
                    )}
                    {signal.hasRsiDivergence && <span className="badge badge-divergence">RSI Div</span>}
                    {isFarFromEntry && <span className="badge badge-pending">Far from entry</span>}
                </div>
            </header>

            <dl
                className="mb-4 grid grid-cols-3 divide-x divide-[var(--card-border)] rounded-lg border border-[var(--card-border)] bg-black/10 py-3"
                aria-label="Planned price levels"
            >
                <PriceLevel label="Entry" value={signal.entryPrice} />
                <PriceLevel label="Stop" value={signal.stopLoss} tone="risk" />
                <PriceLevel label="Target" value={signal.takeProfit} tone="profit" />
            </dl>

            <div className="mb-4">
                <p className="text-sm leading-relaxed">{getEntryGuidance(signal, currentPrice)}</p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
                    Yellow dot = setup trigger, not an exchange fill.
                </p>
            </div>

            <dl className="mb-4 grid grid-cols-3 gap-3 border-y border-[var(--card-border)] py-3 text-sm">
                <Metric
                    label="R:R"
                    value={`1:${signal.riskRewardRatio.toFixed(1)}`}
                    valueClassName={signal.riskRewardRatio >= 2 ? 'text-[var(--long-green)]' : ''}
                    detail={`net ≈ 1:${netRiskReward.ratio.toFixed(1)} after fees`}
                    detailClassName={netRiskReward.ratio < 1.5 ? 'text-amber-300' : ''}
                />
                <Metric label="Confidence" value={`${signal.confidence.toFixed(0)}%`} />
                <Metric
                    label="To entry"
                    value={distanceToEntry === null
                        ? '—'
                        : `${distanceToEntry > 0 ? '+' : distanceToEntry < 0 ? '−' : ''}${Math.abs(distanceToEntry).toFixed(2)}%`}
                />
            </dl>

            {signal.partialTakeProfit && (
                <div className="mb-4 border-l-2 border-[var(--long-green)] pl-3">
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-[var(--text-muted)]">Partial Target</span>
                        <span className="font-semibold text-[var(--long-green)]">
                            {signal.partialTakeProfit.closePercent}% at ${formatPrice(signal.partialTakeProfit.price)}
                        </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-1">Enabled because setup R:R is above 3.</p>
                </div>
            )}

            {hasUnsafeSizing && (
                <p className="mb-4 rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-xs text-amber-200" role="status">
                    Position exceeds safe sizing for this account
                </p>
            )}

            <details className="group mb-4 border-b border-[var(--card-border)] pb-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-1 text-sm font-medium marker:hidden">
                    <span>Position sizing &amp; quantity</span>
                    <ChevronRight
                        aria-hidden="true"
                        className="h-4 w-4 text-[var(--text-muted)] transition-transform group-open:rotate-90"
                    />
                </summary>
                <div className="mt-3 space-y-1.5 border-l border-[var(--card-border)] pl-3">
                    <PreviewRow label="Position notional" value={formatUSD(positionDetails.notionalValue)} />
                    <PreviewRow label="Risk amount" value={formatUSD(positionDetails.riskAmount)} tone="risk" />
                    <PreviewRow label="Margin to allocate" value={formatUSD(positionDetails.marginRequired)} tone="accent" />
                    <PreviewRow
                        label={`${signal.coin} quantity`}
                        value={quantity.displayValue}
                        copyValue={quantity.copyValue}
                    />
                </div>
            </details>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {canOpenPlan && (
                    <button
                        type="button"
                        onClick={handleOpenTicket}
                        disabled={openPlanButton.disabled}
                        className="btn btn-success w-full disabled:cursor-default"
                    >
                        {openPlanButton.label}
                    </button>
                )}
                <button
                    type="button"
                    onClick={handlePlot}
                    className={`btn w-full ${isPlotted ? 'btn-primary' : 'btn-outline'} ${canOpenPlan ? '' : 'sm:col-span-2'}`}
                    title={isPlotted ? 'Remove from chart' : 'Plot on chart'}
                >
                    {isPlotted ? 'Remove from chart' : 'Plot on chart'}
                </button>
            </div>
            {canDismiss && (
                <button
                    type="button"
                    onClick={handleDismiss}
                    className="mt-3 w-full text-center text-[11px] font-medium text-[var(--text-muted)] underline-offset-2 hover:text-white hover:underline"
                >
                    Dismiss setup
                </button>
            )}
        </article>
    );
}

function PriceLevel({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone?: 'risk' | 'profit';
}) {
    const color = tone === 'risk'
        ? 'text-[var(--short-red)]'
        : tone === 'profit'
            ? 'text-[var(--long-green)]'
            : 'text-amber-300';
    return (
        <div className="min-w-0 px-2 text-center">
            <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">{label}</dt>
            <dd className="mt-1 flex min-w-0 flex-wrap items-center justify-center gap-0.5">
                <span className={`whitespace-nowrap font-mono text-xs font-semibold tabular-nums sm:text-sm ${color}`}>${formatPrice(value)}</span>
                <CopyButton label={label.toLowerCase()} value={value} />
            </dd>
        </div>
    );
}

function Metric({
    label,
    value,
    detail,
    valueClassName = '',
    detailClassName = '',
}: {
    label: string;
    value: string;
    detail?: string;
    valueClassName?: string;
    detailClassName?: string;
}) {
    return (
        <div className="min-w-0">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</dt>
            <dd className={`mt-1 font-mono font-semibold tabular-nums ${valueClassName}`}>{value}</dd>
            {detail && (
                <dd className={`mt-1 text-[10px] leading-tight text-[var(--text-muted)] ${detailClassName}`}>
                    {detail}
                </dd>
            )}
        </div>
    );
}

function PreviewRow({
    label,
    value,
    tone,
    copyValue,
}: {
    label: string;
    value: string;
    tone?: 'risk' | 'accent';
    copyValue?: string | number;
}) {
    const color = tone === 'risk'
        ? 'text-[var(--short-red)]'
        : tone === 'accent'
            ? 'text-[var(--accent)]'
            : '';
    return (
        <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--text-muted)]">{label}</span>
            <span className="flex items-center gap-1">
                <span className={`font-mono ${color}`}>{value}</span>
                {copyValue !== undefined && <CopyButton label={label.toLowerCase()} value={copyValue} />}
            </span>
        </div>
    );
}
