'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    getTradeAlertDisplayPrice,
    getTradeAlertKindLabel,
} from '@/lib/alerts/trade-alert-presentation';
import type { TradeAlertKind } from '@/lib/alerts/trade-alert-events';
import { getUnreadAlertCount } from '@/lib/alerts/unread-alerts';
import { formatPrice } from '@/lib/ui/format-price';
import { formatRelativeAge } from '@/lib/ui/signal-display';
import { useTradingStore } from '@/store/trading-store';

const KIND_BADGE_CLASS: Record<TradeAlertKind, string> = {
    NEW_SIGNAL: 'border-[var(--accent)]/50 bg-[var(--accent-dim)] text-[var(--accent)]',
    APPROACHING_ENTRY: 'border-amber-400/50 bg-amber-400/10 text-amber-200',
    ENTRY_HIT: 'border-amber-400/60 bg-amber-400/15 text-amber-100',
    TARGET_HIT: 'border-[var(--long-green)]/50 bg-[var(--long-green-dim)] text-[var(--long-green)]',
    STOP_HIT: 'border-[var(--short-red)]/60 bg-[var(--short-red-dim)] text-[var(--short-red)]',
    BREAK_FORMING: 'border-sky-400/50 bg-sky-400/10 text-sky-200',
    MISSED: 'border-amber-400/50 bg-amber-400/10 text-amber-200',
    INVALIDATED: 'border-[var(--short-red)]/50 bg-[var(--short-red-dim)] text-[var(--short-red)]',
};

export default function AlertCenter() {
    const alertLog = useTradingStore((state) => state.alertLog);
    const alertsLastSeenAt = useTradingStore((state) => state.alertsLastSeenAt);
    const signals = useTradingStore((state) => state.signals);
    const focusSignal = useTradingStore((state) => state.focusSignal);
    const markAlertsSeen = useTradingStore((state) => state.markAlertsSeen);
    const [isOpen, setIsOpen] = useState(false);
    const [now, setNow] = useState(0);
    const rootRef = useRef<HTMLDivElement>(null);

    const unreadCount = useMemo(
        () => getUnreadAlertCount(alertLog, alertsLastSeenAt),
        [alertLog, alertsLastSeenAt]
    );
    const newestFirst = useMemo(() => [...alertLog].reverse(), [alertLog]);
    const signalIds = useMemo(() => new Set(signals.map((signal) => signal.id)), [signals]);

    useEffect(() => {
        if (!isOpen) return;

        const firstTick = window.setTimeout(() => setNow(Date.now()), 0);
        const interval = window.setInterval(() => setNow(Date.now()), 60000);
        const handlePointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false);
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            window.clearTimeout(firstTick);
            window.clearInterval(interval);
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    const handleToggle = () => {
        const nextOpen = !isOpen;
        setIsOpen(nextOpen);
        if (nextOpen) markAlertsSeen();
    };

    const handleAlertClick = (signalId: string) => {
        focusSignal(signalId);
        setIsOpen(false);
    };

    return (
        <div ref={rootRef} className="relative flex items-center gap-2">
            <button
                type="button"
                aria-label={unreadCount > 0 ? `Alerts, ${unreadCount} unread` : 'Alerts'}
                aria-expanded={isOpen}
                aria-controls="trade-alert-center"
                onClick={handleToggle}
                className="btn btn-outline relative px-3"
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
                    <path d="M10 21h4" />
                </svg>
                {unreadCount > 0 && (
                    <span className="absolute -right-2 -top-2 min-w-5 rounded-full bg-[var(--short-red)] px-1.5 py-0.5 text-[10px] font-bold leading-4 text-white">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <section
                    id="trade-alert-center"
                    aria-label="Alerts log"
                    className="popover fixed inset-x-4 top-36 z-[80] mt-2 w-auto overflow-hidden sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:w-96"
                >
                    <div className="flex items-center justify-between border-b border-[var(--hairline)] px-4 py-3">
                        <div>
                            <h2 className="text-sm font-semibold">Alerts log</h2>
                            <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Newest activity across all markets</p>
                        </div>
                        <span className="text-xs text-[var(--text-muted)]">{alertLog.length}/100</span>
                    </div>

                    <div className="max-h-[min(32rem,calc(100dvh-12rem))] overflow-y-auto overscroll-contain">
                        {newestFirst.length === 0 ? (
                            <p className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                                Alerts will appear here when setups change.
                            </p>
                        ) : (
                            newestFirst.map((event) => {
                                const canFocus = Boolean(event.signalId && signalIds.has(event.signalId));
                                const rowKey = `${event.kind}:${event.signalId ?? event.coin}:${event.timeframe}:${event.occurredAt}`;
                                return (
                                    <button
                                        key={rowKey}
                                        type="button"
                                        disabled={!canFocus}
                                        onClick={() => event.signalId && handleAlertClick(event.signalId)}
                                        className="flex w-full items-start gap-3 border-b border-[var(--card-border)]/70 px-4 py-3 text-left transition-colors last:border-b-0 enabled:hover:bg-[var(--card-hover)] disabled:cursor-default disabled:opacity-50"
                                        title={canFocus ? 'Open this signal' : 'This alert has no active signal to open'}
                                    >
                                        <span className={`mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold ${KIND_BADGE_CLASS[event.kind]}`}>
                                            {getTradeAlertKindLabel(event.kind)}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium">
                                                {event.coin} {event.timeframe} · {event.direction}
                                            </span>
                                            <span className="mt-1 block text-xs text-[var(--text-muted)]">
                                                ${formatPrice(getTradeAlertDisplayPrice(event))} · {formatRelativeAge(event.occurredAt, now)}
                                            </span>
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </section>
            )}
        </div>
    );
}
