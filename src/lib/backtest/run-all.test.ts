import { describe, expect, it, vi } from 'vitest';
import type { Candle, Timeframe } from '@/lib/trading/types';
import { getTimeframeMs } from '@/lib/trading/types';
import {
    BACKTEST_MAX_CANDLES,
    runBacktest,
    type BacktestProgress,
    type RunBacktestOptions,
} from './run-all';

const NOW = Date.UTC(2026, 5, 1);
const settings = { minStopDistancePercent: 0.8, maxRiskRewardRatio: 8 };

/** Flat history: enough candles to replay, nothing for the scanner to find. */
function flatCandles(timeframe: Timeframe, count = 300): Candle[] {
    const duration = getTimeframeMs(timeframe);
    return Array.from({ length: count }, (_, index) => ({
        time: NOW - ((count - index) * duration),
        open: 100, high: 100, low: 100, close: 100, volume: 1,
    }));
}

describe('runBacktest', () => {
    it('loads the deepest history per market and shares 1h context across lower timeframes', async () => {
        const fetchCandles = vi.fn<RunBacktestOptions['fetchCandles']>(
            async (_coin, timeframe) => flatCandles(timeframe)
        );
        const progress: BacktestProgress[] = [];

        const run = await runBacktest({
            coins: ['BTC', 'ETH'],
            timeframes: ['5m', '15m'],
            settings,
            now: NOW,
            fetchCandles,
            onProgress: (update) => progress.push(update),
        });

        expect(fetchCandles.mock.calls.map(([coin, timeframe]) => `${coin} ${timeframe}`)).toEqual([
            'BTC 5m', 'BTC 1h', 'ETH 5m', 'ETH 1h', 'BTC 15m', 'ETH 15m',
        ]);
        expect(fetchCandles.mock.calls[0][2]).toBe(NOW - (BACKTEST_MAX_CANDLES * getTimeframeMs('5m')));
        expect(run).toMatchObject({ results: [], invalidated: 0, ambiguous: 0, open: 0, failed: [] });
        expect(run?.coverage.map((item) => item.timeframe)).toEqual(['5m', '15m']);
        expect(progress.at(-1)).toEqual({ completed: 4, total: 4, current: '' });
    });

    it('reports markets that fail to load and keeps going', async () => {
        const run = await runBacktest({
            coins: ['BTC', 'ETH'],
            timeframes: ['1h'],
            settings,
            now: NOW,
            fetchCandles: async (coin, timeframe) => {
                if (coin === 'BTC') throw new Error('outage');
                return flatCandles(timeframe);
            },
        });

        expect(run?.failed).toEqual(['BTC 1h']);
        expect(run?.coverage).toHaveLength(1);
    });

    it('stops and returns null when cancelled', async () => {
        const fetchCandles = vi.fn(async (_coin: string, timeframe: Timeframe) => flatCandles(timeframe));

        const run = await runBacktest({
            coins: ['BTC', 'ETH'],
            timeframes: ['1h'],
            settings,
            now: NOW,
            fetchCandles,
            isCancelled: () => fetchCandles.mock.calls.length >= 1,
        });

        expect(run).toBeNull();
        expect(fetchCandles).toHaveBeenCalledTimes(1);
    });
});
