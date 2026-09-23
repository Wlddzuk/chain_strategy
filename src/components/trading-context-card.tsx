'use client';

import type { MutableRefObject } from 'react';
import {
    Gauge,
    ScanSearch,
    ShieldCheck,
    type LucideIcon,
} from 'lucide-react';
import MarketStatusCard from '@/components/market-status-card';
import type { MarketConnectionStatus } from '@/lib/api/hyperliquid-ws';
import { useTradingStore } from '@/store/trading-store';

interface TradingContextCardProps {
    connectionStatus: MarketConnectionStatus;
    lastLiveUpdateRef: MutableRefObject<number | null>;
    className?: string;
}

interface ContextMetricProps {
    icon: LucideIcon;
    label: string;
    value: string;
    detail: string;
    live?: boolean;
}

function ContextMetric({
    icon: Icon,
    label,
    value,
    detail,
    live = false,
}: ContextMetricProps) {
    return (
        <div className="flex min-h-[4.5rem] flex-col justify-between gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--background)]/55 p-3">
            <div className="flex items-center justify-between gap-2">
                <span className="stat-label">{label}</span>
                <Icon aria-hidden="true" className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            </div>
            <div>
                <p
                    aria-live={live ? 'polite' : undefined}
                    className="font-mono text-sm font-semibold tabular-nums text-[var(--foreground)]"
                >
                    {value}
                </p>
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">{detail}</p>
            </div>
        </div>
    );
}

export default function TradingContextCard({
    connectionStatus,
    lastLiveUpdateRef,
    className = '',
}: TradingContextCardProps) {
    const riskPercent = useTradingStore((state) => state.settings.riskPercent);
    const leverage = useTradingStore((state) => state.settings.leverage);
    const isScanning = useTradingStore((state) => state.isScanning);

    return (
        <section
            aria-labelledby="trading-context-title"
            className={`card min-h-36 ${className}`}
        >
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <h2 id="trading-context-title" className="stat-label">
                        Trading context
                    </h2>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                        Plan defaults and system health
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                <ContextMetric
                    icon={ShieldCheck}
                    label="Risk"
                    value={`${riskPercent}%`}
                    detail="of equity per plan"
                />
                <ContextMetric
                    icon={Gauge}
                    label="Leverage"
                    value={`${leverage}x`}
                    detail="default plan setting"
                />
                <MarketStatusCard
                    connectionStatus={connectionStatus}
                    lastLiveUpdateRef={lastLiveUpdateRef}
                    variant="compact"
                />
                <ContextMetric
                    icon={ScanSearch}
                    label="Scanner"
                    value={isScanning ? 'Scanning…' : 'Watching'}
                    detail="background sweep"
                    live
                />
            </div>
        </section>
    );
}
