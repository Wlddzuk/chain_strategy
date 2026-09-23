import { getTimeframeMs, type Timeframe } from '@/lib/trading/types';

export function getMillisecondsUntilCandleClose(now: number, timeframe: Timeframe): number {
    if (!Number.isFinite(now)) return 0;

    const duration = getTimeframeMs(timeframe);
    const elapsed = ((now % duration) + duration) % duration;
    return elapsed === 0 ? duration : duration - elapsed;
}

export function formatCandleCountdown(remainingMilliseconds: number): string {
    const totalSeconds = Number.isFinite(remainingMilliseconds)
        ? Math.max(0, Math.ceil(remainingMilliseconds / 1000))
        : 0;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
