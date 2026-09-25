import type { Timeframe } from '@/lib/trading/types';

export interface ChartScopeEmptyState {
    message: string;
    canViewAll: boolean;
}

export function getChartScopeEmptyState(
    coin: string,
    timeframe: Timeframe,
    allActiveCount: number
): ChartScopeEmptyState {
    const safeCount = Number.isFinite(allActiveCount)
        ? Math.max(0, Math.floor(allActiveCount))
        : 0;

    return {
        message: `No signals for ${coin} ${timeframe} — ${safeCount} active in other markets`,
        canViewAll: safeCount > 0,
    };
}
