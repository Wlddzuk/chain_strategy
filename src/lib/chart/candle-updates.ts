import type { Candle } from '@/lib/trading/types';

/** A last-bar update is valid only when every earlier bar is unchanged. */
export function canUpdateLastCandle(previous: readonly Candle[], next: readonly Candle[]): boolean {
    if (!previous.length || next.length < previous.length || next.length > previous.length + 1) return false;
    if (next.at(-1)!.time < previous.at(-1)!.time) return false;
    const unchangedCount = next.length === previous.length ? previous.length - 1 : previous.length;
    return previous.slice(0, unchangedCount).every((bar, index) => {
        const incoming = next[index];
        return bar === incoming || (
            bar.time === incoming.time && bar.open === incoming.open && bar.high === incoming.high &&
            bar.low === incoming.low && bar.close === incoming.close && bar.volume === incoming.volume
        );
    }) && (next.length !== previous.length || next.at(-1)!.time === previous.at(-1)!.time);
}

/**
 * Fit the time scale on the first load, and again when a rebuild brings in older history
 * (a REST snapshot replacing the few live bars a freshly selected timeframe started with).
 * Rolling windows and corrected bars keep the user's current zoom.
 */
export function shouldFitAfterRebuild(previous: readonly Candle[], next: readonly Candle[]): boolean {
    if (!next.length) return false;
    if (!previous.length) return true;
    return next[0].time < previous[0].time;
}
