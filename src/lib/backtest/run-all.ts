import {
    advanceMarketBacktest,
    countOpenPlans,
    createMarketBacktest,
    type BacktestSettings,
} from '@/lib/backtest/run-backtest';
import { getTimeframeMs, type Candle, type Timeframe } from '@/lib/trading/types';
import type { OutcomeHistoryItem } from '@/lib/ui/strategy-record';

/** Hyperliquid serves at most this many candles per market and interval. */
export const BACKTEST_MAX_CANDLES = 5000;
/** Candles replayed between pauses that let the page repaint. */
const STEPS_PER_SLICE = 250;

export interface BacktestProgress {
    completed: number;
    total: number;
    /** Market being fetched or replayed, e.g. "BTC 1h". */
    current: string;
}

export interface BacktestCoverage {
    timeframe: Timeframe;
    /** Earliest candle replayed across the coins on this timeframe. */
    from: number;
    to: number;
}

export interface BacktestRun {
    results: OutcomeHistoryItem[];
    coverage: BacktestCoverage[];
    /** Plans cancelled before entry because they expired or were closed through. */
    invalidated: number;
    /** Candles spanning both entry and target before a fill; counted as missed. */
    ambiguous: number;
    /** Plans still waiting or in a trade when the candles ran out. */
    open: number;
    /** Markets that could not be loaded, e.g. "ARB 5m". */
    failed: string[];
}

export interface RunBacktestOptions {
    coins: readonly string[];
    timeframes: readonly Timeframe[];
    settings: BacktestSettings;
    now: number;
    fetchCandles: (coin: string, timeframe: Timeframe, startTime: number, endTime: number) => Promise<Candle[]>;
    onProgress?: (progress: BacktestProgress) => void;
    /** Resolves after the page has had a chance to repaint. */
    pause?: () => Promise<void>;
    isCancelled?: () => boolean;
}

function closedOnly(candles: Candle[], timeframe: Timeframe, now: number): Candle[] {
    const duration = getTimeframeMs(timeframe);
    return candles.filter((candle) => candle.time + duration <= now);
}

/**
 * Replays the live scanner over as much history as Hyperliquid serves for
 * every coin and timeframe. Returns null if cancelled.
 */
export async function runBacktest(options: RunBacktestOptions): Promise<BacktestRun | null> {
    const { coins, timeframes, settings, now, fetchCandles } = options;
    const run: BacktestRun = { results: [], coverage: [], invalidated: 0, ambiguous: 0, open: 0, failed: [] };
    const total = coins.length * timeframes.length;
    const higherCache = new Map<string, Candle[]>();
    let completed = 0;

    const load = (coin: string, timeframe: Timeframe) => fetchCandles(
        coin,
        timeframe,
        now - (BACKTEST_MAX_CANDLES * getTimeframeMs(timeframe)),
        now
    ).then((candles) => closedOnly(candles, timeframe, now));

    for (const timeframe of timeframes) {
        let from = Infinity;
        let to = -Infinity;

        for (const coin of coins) {
            if (options.isCancelled?.()) return null;
            const current = `${coin} ${timeframe}`;
            options.onProgress?.({ completed, total, current });

            try {
                const candles = await load(coin, timeframe);
                let higherTimeframeCandles: Candle[] | undefined;
                if (timeframe === '5m' || timeframe === '15m') {
                    higherTimeframeCandles = higherCache.get(coin);
                    if (!higherTimeframeCandles) {
                        higherTimeframeCandles = await load(coin, '1h');
                        higherCache.set(coin, higherTimeframeCandles);
                    }
                }

                const backtest = createMarketBacktest({ coin, timeframe, candles, higherTimeframeCandles, settings });
                const firstReplayed = candles[backtest.index];
                while (!advanceMarketBacktest(backtest, STEPS_PER_SLICE)) {
                    await options.pause?.();
                    if (options.isCancelled?.()) return null;
                }

                run.results.push(...backtest.results);
                run.invalidated += backtest.invalidated;
                run.ambiguous += backtest.ambiguous;
                run.open += countOpenPlans(backtest);
                if (firstReplayed) {
                    from = Math.min(from, firstReplayed.time);
                    to = Math.max(to, candles[candles.length - 1].time + getTimeframeMs(timeframe));
                }
            } catch {
                run.failed.push(current);
            }
            completed += 1;
        }

        if (Number.isFinite(from)) run.coverage.push({ timeframe, from, to });
    }

    options.onProgress?.({ completed, total, current: '' });
    run.results.sort((first, second) => first.closedAt - second.closedAt);
    return run;
}
