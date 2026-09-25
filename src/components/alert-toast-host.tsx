'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    getTradeAlertBody,
    getTradeAlertKindLabel,
} from '@/lib/alerts/trade-alert-presentation';
import {
    TRADE_ALERT_EVENT,
    type TradeAlertEvent,
} from '@/lib/alerts/trade-alert-events';
import { useTradingStore } from '@/store/trading-store';

const TOAST_DURATION_MS = 8000;
const MAX_TOASTS = 3;

interface AlertToast {
    id: string;
    event: TradeAlertEvent;
    expiresAt: number;
}

export default function AlertToastHost() {
    const signals = useTradingStore((state) => state.signals);
    const focusSignal = useTradingStore((state) => state.focusSignal);
    const [toasts, setToasts] = useState<AlertToast[]>([]);
    const sequenceRef = useRef(0);
    const signalIds = useMemo(() => new Set(signals.map((signal) => signal.id)), [signals]);

    useEffect(() => {
        const handleTradeAlert = (domEvent: Event) => {
            const event = (domEvent as CustomEvent<TradeAlertEvent>).detail;
            if (
                document.visibilityState !== 'visible' ||
                !useTradingStore.getState().settings.alertsEnabled
            ) return;

            sequenceRef.current += 1;
            const now = Date.now();
            const toast: AlertToast = {
                id: `${event.kind}:${event.signalId ?? event.coin}:${event.occurredAt}:${sequenceRef.current}`,
                event,
                expiresAt: now + TOAST_DURATION_MS,
            };
            setToasts((current) => [...current, toast].slice(-MAX_TOASTS));
        };

        window.addEventListener(TRADE_ALERT_EVENT, handleTradeAlert);
        return () => window.removeEventListener(TRADE_ALERT_EVENT, handleTradeAlert);
    }, []);

    useEffect(() => {
        if (toasts.length === 0) return;

        const nextExpiry = Math.min(...toasts.map((toast) => toast.expiresAt));
        const timeout = window.setTimeout(() => {
            const now = Date.now();
            setToasts((current) => current.filter((toast) => toast.expiresAt > now));
        }, Math.max(0, nextExpiry - Date.now()));

        return () => window.clearTimeout(timeout);
    }, [toasts]);

    const handleToastClick = (toast: AlertToast) => {
        if (toast.event.signalId && signalIds.has(toast.event.signalId)) {
            focusSignal(toast.event.signalId);
        }
        setToasts((current) => current.filter((candidate) => candidate.id !== toast.id));
    };

    if (toasts.length === 0) return null;

    return (
        // Bottom-right, like system notifications, so toasts never cover the header controls.
        <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
            {toasts.map((toast) => {
                const canFocus = Boolean(toast.event.signalId && signalIds.has(toast.event.signalId));
                const content = (
                    <>
                        <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                            {getTradeAlertKindLabel(toast.event.kind)}
                        </span>
                        <span className="mt-1 block text-sm font-semibold">
                            {toast.event.coin} {toast.event.direction} · {toast.event.timeframe}
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-[var(--text-muted)]">
                            {getTradeAlertBody(toast.event)}
                        </span>
                    </>
                );
                const className = `toast-enter press material-popover pointer-events-auto w-full rounded-2xl border px-4 py-3 text-left ${
                    toast.event.urgent
                        ? 'border-[var(--short-red)]/60'
                        : 'border-[var(--hairline-strong)]'
                }`;

                return (
                    <button
                        key={toast.id}
                        type="button"
                        onClick={() => handleToastClick(toast)}
                        className={`${className} transition-colors hover:bg-[var(--card-hover)] ${canFocus ? '' : 'opacity-80'}`}
                        title={canFocus ? 'Open this signal' : 'Dismiss alert'}
                    >
                        {content}
                    </button>
                );
            })}
        </div>
    );
}
