'use client';

import { type MutableRefObject, useEffect, useState } from 'react';
import { DatabaseZap } from 'lucide-react';
import type { MarketConnectionStatus } from '@/lib/api/hyperliquid-ws';

interface MarketStatusCardProps {
    connectionStatus: MarketConnectionStatus;
    lastLiveUpdateRef: MutableRefObject<number | null>;
    variant?: 'card' | 'compact';
    className?: string;
}

export default function MarketStatusCard({
    connectionStatus,
    lastLiveUpdateRef,
    variant = 'card',
    className = '',
}: MarketStatusCardProps) {
    const [liveAgeSeconds, setLiveAgeSeconds] = useState<number | null>(null);

    useEffect(() => {
        const timer = setInterval(() => {
            const lastLiveUpdate = lastLiveUpdateRef.current;
            setLiveAgeSeconds(lastLiveUpdate
                ? Math.max(0, Math.floor((Date.now() - lastLiveUpdate) / 1000))
                : null);
        }, 1000);
        return () => clearInterval(timer);
    }, [lastLiveUpdateRef]);

    const isFresh = connectionStatus === 'LIVE' && liveAgeSeconds !== null && liveAgeSeconds < 20;
    const marketStatusLabel = isFresh
        ? `Live ${liveAgeSeconds}s`
        : connectionStatus === 'LIVE'
            ? 'Connected - waiting tick'
            : connectionStatus.toLowerCase();

    const content = (
        <div className="flex min-h-[4.5rem] flex-col justify-between gap-2">
            <div className="flex items-center justify-between gap-2">
                <span className="stat-label">Market data</span>
                <DatabaseZap
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 ${isFresh ? 'text-[var(--long-green)]' : 'text-[var(--text-muted)]'}`}
                />
            </div>
            <div>
                <div className="flex items-center gap-2">
                    <span
                        aria-hidden="true"
                        className={`h-2 w-2 shrink-0 rounded-full ${isFresh ? 'live-dot' : 'animate-pulse bg-[var(--warning)]'}`}
                    />
                    <span className="font-mono text-sm font-semibold capitalize tabular-nums text-[var(--foreground)]">
                        {marketStatusLabel}
                    </span>
                </div>
                <span className="mt-1 block text-[10px] text-[var(--text-muted)]">
                    Hyperliquid mainnet
                </span>
            </div>
        </div>
    );

    if (variant === 'compact') {
        return (
            <div className={`rounded-lg border border-[var(--card-border)] bg-[var(--background)]/55 p-3 ${className}`}>
                {content}
            </div>
        );
    }

    return <div className={`card ${className}`}>{content}</div>;
}
