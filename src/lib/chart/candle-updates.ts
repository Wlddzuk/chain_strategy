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
