'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import CopyButton from '@/components/copy-button';
import SignalStatusStrip from '@/components/signal-status-strip';
import type { ChainSignal } from '@/lib/trading/types';
import { buildRiskDeskUrl, RISK_DESK_URL } from '@/lib/trading/risk-desk';
import {
    calculatePnL,
    calculatePositionSize,
    formatPercent,
    formatUSD,
    validateTradeParams,
} from '@/lib/trading/risk-calculator';
import { focusStrategyChart } from '@/lib/ui/focus-chart';
import { getRoundedQuantity } from '@/lib/ui/format-quantity';
import { formatPrice } from '@/lib/ui/format-price';
import { TRADE_TICKET_HIGHLIGHT_MS } from '@/lib/ui/trade-plan-actions';
import { calculateNetRiskReward, isPositionSizingUnsafe } from '@/lib/ui/trade-metrics';
import {
    formatRelativeAge,
    getEntryGuidance,
    getSignalStatusBadgeClass,
    getSignalStatusLabel,
} from '@/lib/ui/signal-display';
import { useTradingStore } from '@/store/trading-store';

interface TradeTicketProps {
    signal: ChainSignal;
    now: number;
}

export default function TradeTicket({ signal, now }: TradeTicketProps) {
    const storedAccountEquity = useTradingStore((state) => state.settings.accountEquity);
    const storedRiskPercent = useTradingStore((state) => state.settings.riskPercent);
    const storedLeverage = useTradingStore((state) => state.settings.leverage);
    const feePercentPerSide = useTradingStore((state) => state.settings.feePercentPerSide);
    const approachThresholdPercent = useTradingStore((state) => state.settings.approachThresholdPercent);
    const sizeDecimals = useTradingStore((state) => state.sizeDecimals[signal.coin]);
    // Keep live lifecycle evaluation in the store; the ticket refreshes this
    // informational quote on the shared minute tick or a status transition.
    const currentPrice = useTradingStore.getState().prices[signal.coin] ?? 0;
    const plottedSignal = useTradingStore((state) => state.plottedSignal);
    const updateSettings = useTradingStore((state) => state.updateSettings);
    const updateSignalStatus = useTradingStore((state) => state.updateSignalStatus);
    const updateExecutionChecklist = useTradingStore((state) => state.updateExecutionChecklist);
    const selectSignal = useTradingStore((state) => state.selectSignal);
    const focusSignal = useTradingStore((state) => state.focusSignal);
    const [accountEquity, setAccountEquity] = useState(signal.sizing?.equity ?? storedAccountEquity);
    const [riskPercent, setRiskPercent] = useState(signal.sizing?.riskPercent ?? storedRiskPercent);
    const [leverage, setLeverage] = useState(signal.sizing?.leverage ?? storedLeverage);
    const [isHighlighted, setIsHighlighted] = useState(true);
    const ticketRef = useRef<HTMLElement>(null);

    const params = useMemo(() => ({
        equity: accountEquity,
        riskPercent,
        leverage,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
    }), [accountEquity, leverage, riskPercent, signal.entryPrice, signal.stopLoss]);
    const position = useMemo(() => calculatePositionSize(params), [params]);
    const quantity = getRoundedQuantity(position.positionSize, sizeDecimals);
    const errors = useMemo(() => validateTradeParams(params), [params]);
    const riskDeskUrl = useMemo(() => buildRiskDeskUrl(signal, params), [signal, params]);
    const hasUnsafeSizing = isPositionSizingUnsafe(position, accountEquity, leverage);
    const netRiskReward = calculateNetRiskReward(
        signal.entryPrice,
        signal.stopLoss,
        signal.takeProfit,
        feePercentPerSide
    );
    const potentialProfit = calculatePnL(
        position.positionSize,
        signal.entryPrice,
        signal.takeProfit,
        signal.direction
    );
    const isPending = signal.status === 'PENDING';
    const isPlotted = plottedSignal?.id === signal.id;
    const statusLabel = getSignalStatusLabel(signal, now);
    const checklist = signal.executionChecklist ?? {
        limitOrderPlaced: false,
        stopSet: false,
        takeProfitSet: false,
    };
    const copiedPlan = [
        `Direction: ${signal.direction}`,
        `Coin: ${signal.coin}`,
        `Timeframe: ${signal.timeframe}`,
        `Entry: ${signal.entryPrice}`,
        `Stop: ${signal.stopLoss}`,
        `Target: ${signal.takeProfit}`,
        `Quantity: ${quantity.copyValue}`,
        `Notional: ${position.notionalValue}`,
        `R:R: 1:${signal.riskRewardRatio}`,
    ].join('\n');

    const handleShowOnChart = () => {
        focusSignal(signal.id);
        focusStrategyChart();
    };

    const handleAccept = () => {
        if (!isPending || errors.length > 0) return;
        updateSettings({ accountEquity, riskPercent, leverage });
        updateSignalStatus(signal.id, 'APPROVED');
        focusSignal(signal.id);
        focusStrategyChart();
    };

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            ticketRef.current?.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
            });
        });
        const highlightTimer = window.setTimeout(() => {
            setIsHighlighted(false);
        }, TRADE_TICKET_HIGHLIGHT_MS);

        return () => {
            window.cancelAnimationFrame(frame);
            window.clearTimeout(highlightTimer);
        };
    }, []);

    return (
        <section
            ref={ticketRef}
            className={`card border-[var(--accent)]/60 transition-shadow duration-300 ${
                isHighlighted
                    ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--background)]'
                    : ''
            }`}
            aria-label="Trade planning ticket"
            data-signal-id={signal.id}
        >
            <SignalStatusStrip
                signal={signal}
                currentPrice={currentPrice}
                approachThresholdPercent={approachThresholdPercent}
                now={now}
            />

            <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`badge ${signal.direction === 'LONG' ? 'badge-long' : 'badge-short'}`}>
                            {signal.direction}
                        </span>
                        <h3 className="font-semibold">{signal.coin} {signal.timeframe} plan</h3>
                        <span className="text-[11px] text-[var(--text-muted)]">· fired {formatRelativeAge(signal.createdAt, now)}</span>
                        {statusLabel && (
                            <span className={`badge ${getSignalStatusBadgeClass(signal)}`}>
                                {statusLabel}
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-2">
                        Planning only — accepting never sends an exchange order.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => selectSignal(null)}
                    className="text-[var(--text-muted)] hover:text-white p-1"
                    aria-label="Close trade plan"
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {(signal.status === 'FILLED' || signal.status === 'TOUCHED' || signal.outcome) && (
                <p className="mb-4 text-xs text-[var(--text-muted)]">
                    Tracking is based on price reaching the planned levels — not your actual exchange fills.
                </p>
            )}

            <div className="grid grid-cols-3 gap-2 text-xs mb-4">
                <Level label="Entry" value={signal.entryPrice} color="#fbbf24" />
                <Level label="Stop" value={signal.stopLoss} color="var(--short-red)" />
                <Level label="Target" value={signal.takeProfit} color="var(--long-green)" />
            </div>

            <div className="mb-4 rounded-lg border border-[var(--card-border)] bg-[var(--background)] p-3 text-xs">
                <p>{getEntryGuidance(signal, currentPrice)}</p>
                <p className="mt-1 text-[var(--text-muted)]">Yellow dot = setup trigger; it does not mean the Entry filled.</p>
                <p className="mt-2">
                    Gross R:R 1:{signal.riskRewardRatio.toFixed(1)} ·{' '}
                    <span className={netRiskReward.ratio < 1.5 ? 'text-amber-300' : 'text-[var(--text-muted)]'}>
                        net ≈ 1:{netRiskReward.ratio.toFixed(1)} after fees
                    </span>
                </p>
            </div>

            {isPending && (
                <div className="space-y-3 border-y border-[var(--card-border)] py-4">
                    <NumberField
                        id="ticket-equity"
                        label="Account balance"
                        prefix="$"
                        value={accountEquity}
                        min={1}
                        step={100}
                        onChange={setAccountEquity}
                    />
                    <NumberField
                        id="ticket-risk"
                        label="Risk per trade"
                        suffix="%"
                        value={riskPercent}
                        min={0.1}
                        max={10}
                        step={0.1}
                        onChange={setRiskPercent}
                    />
                    <NumberField
                        id="ticket-leverage"
                        label="Leverage"
                        suffix="x"
                        value={leverage}
                        min={1}
                        max={50}
                        step={1}
                        onChange={setLeverage}
                    />
                </div>
            )}

            <div className="grid grid-cols-2 gap-3 py-4 text-sm">
                <Metric label="Dollar risk" value={formatUSD(position.riskAmount)} tone="risk" />
                <Metric label="Stop distance" value={formatPercent(position.stopDistancePercent)} />
                <Metric label="Position notional" value={formatUSD(position.notionalValue)} />
                <Metric label="Margin to allocate" value={formatUSD(position.marginRequired)} tone="accent" />
                <Metric
                    label={`${signal.coin} quantity`}
                    value={quantity.displayValue}
                    copyValue={quantity.copyValue}
                />
                <Metric label={`Target profit (${signal.riskRewardRatio.toFixed(2)}R)`} value={formatUSD(potentialProfit)} tone="profit" />
            </div>

            <div className="mb-2 flex flex-wrap justify-end gap-2">
                {riskDeskUrl && (
                    <a
                        href={riskDeskUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-[var(--accent)] px-3 py-2 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/10"
                    >
                        Open in Risk Desk ↗
                    </a>
                )}
                <CopyButton
                    label="trade plan"
                    value={copiedPlan}
                    text="Copy plan"
                    className="border border-[var(--card-border)] text-xs"
                />
            </div>
            <p className="mb-4 text-xs text-[var(--text-muted)]">
                Sends a draft with these levels and sizing settings. Risk Desk applies its fee model.
                {' '}If asked to sign in, return here and open the plan again.
                {!riskDeskUrl && <> Fix the sizing values to open a draft in <a href={RISK_DESK_URL} target="_blank" rel="noopener noreferrer" className="underline">Risk Desk</a>.</>}
            </p>

            {(signal.status === 'APPROVED' || signal.status === 'FILLED') && (
                <fieldset className="mb-4 rounded-lg border border-[var(--card-border)] bg-[var(--background)] p-3">
                    <legend className="px-1 text-xs font-semibold">Exchange checklist</legend>
                    <p className="mb-3 text-[11px] text-[var(--text-muted)]">
                        Manual reminders only — the app does not place or verify these orders.
                    </p>
                    <div className="space-y-2 text-sm">
                        <ChecklistItem
                            label="Entry order placed"
                            checked={checklist.limitOrderPlaced}
                            onChange={(checked) => updateExecutionChecklist(signal.id, 'limitOrderPlaced', checked)}
                        />
                        <ChecklistItem
                            label="Stop set"
                            checked={checklist.stopSet}
                            onChange={(checked) => updateExecutionChecklist(signal.id, 'stopSet', checked)}
                        />
                        <ChecklistItem
                            label="Target set"
                            checked={checklist.takeProfitSet}
                            onChange={(checked) => updateExecutionChecklist(signal.id, 'takeProfitSet', checked)}
                        />
                    </div>
                </fieldset>
            )}

            <div className="text-xs text-[var(--text-muted)] mb-4 space-y-1">
                <p>Current market price: {currentPrice > 0 ? `$${formatPrice(currentPrice)}` : 'waiting for feed'}.</p>
                <p>The net R:R includes the configured fee estimate; funding, slippage, liquidation risk, and actual execution are not included.</p>
            </div>

            {hasUnsafeSizing && (
                <div className="rounded-lg border border-amber-400/50 bg-amber-400/10 p-3 text-xs text-amber-200 mb-4" role="status">
                    Position exceeds safe sizing for this account
                </div>
            )}

            {isPending && errors.length > 0 && (
                <div className="rounded-lg border border-[var(--short-red)] bg-[var(--short-red-dim)] p-3 text-xs text-[var(--short-red)] mb-4">
                    {errors[0]}
                </div>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {isPending && (
                    <button
                        type="button"
                        onClick={handleAccept}
                        disabled={errors.length > 0}
                        className="btn btn-success w-full"
                    >
                        Accept plan &amp; plot
                    </button>
                )}
                <button
                    type="button"
                    onClick={handleShowOnChart}
                    className={`btn w-full ${isPlotted ? 'btn-primary' : 'btn-outline'} ${isPending ? '' : 'sm:col-span-2'}`}
                >
                    {isPlotted ? 'Show plotted setup' : 'Plot setup on chart'}
                </button>
            </div>
        </section>
    );
}

function Level({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className="rounded-lg bg-[var(--background)] p-2 min-w-0">
            <div className="text-[var(--text-muted)]">{label}</div>
            <div className="mt-1 flex min-w-0 items-center gap-1">
                <div className="min-w-0 truncate font-mono" style={{ color }}>${formatPrice(value)}</div>
                <CopyButton label={label.toLowerCase()} value={value} />
            </div>
        </div>
    );
}

function Metric({
    label,
    value,
    tone,
    copyValue,
}: {
    label: string;
    value: string;
    tone?: 'risk' | 'profit' | 'accent';
    copyValue?: string | number;
}) {
    const color = tone === 'risk'
        ? 'text-[var(--short-red)]'
        : tone === 'profit'
            ? 'text-[var(--long-green)]'
            : tone === 'accent'
                ? 'text-[var(--accent)]'
                : 'text-white';

    return (
        <div>
            <div className="text-xs text-[var(--text-muted)]">{label}</div>
            <div className="mt-1 flex items-center gap-1">
                <div className={`font-mono ${color}`}>{value}</div>
                {copyValue !== undefined && <CopyButton label={label.toLowerCase()} value={copyValue} />}
            </div>
        </div>
    );
}

function ChecklistItem({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <label className="flex cursor-pointer items-center gap-2">
            <input
                type="checkbox"
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>{label}</span>
        </label>
    );
}

interface NumberFieldProps {
    id: string;
    label: string;
    value: number;
    min: number;
    max?: number;
    step: number;
    prefix?: string;
    suffix?: string;
    onChange: (value: number) => void;
}

function NumberField({
    id,
    label,
    value,
    min,
    max,
    step,
    prefix,
    suffix,
    onChange,
}: NumberFieldProps) {
    return (
        <label htmlFor={id} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-[var(--text-muted)]">{label}</span>
            <span className="relative w-36">
                {prefix && <span className="absolute left-3 top-2.5 text-[var(--text-muted)]">{prefix}</span>}
                <input
                    id={id}
                    type="number"
                    value={Number.isFinite(value) ? value : ''}
                    min={min}
                    max={max}
                    step={step}
                    onChange={(event) => onChange(Number(event.target.value))}
                    className={`input w-full ${prefix ? 'pl-7' : ''} ${suffix ? 'pr-8' : ''}`}
                />
                {suffix && <span className="absolute right-3 top-2.5 text-[var(--text-muted)]">{suffix}</span>}
            </span>
        </label>
    );
}
