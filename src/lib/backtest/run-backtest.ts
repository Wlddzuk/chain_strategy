import {
    scanForSignals,
    type ChainStrategyState,
} from '@/lib/trading/chain-strategy';
import {
    getTimeframeMs,
    type Candle,
    type ChainSignal,
    type Timeframe,
} from '@/lib/trading/types';
import type { OutcomeHistoryItem } from '@/lib/ui/strategy-record';

/** The live scanner sees the latest 200 candles of a market; the replay does too. */
export const BACKTEST_WINDOW = 200;
const HIGHER_TIMEFRAME: Partial<Record<Timeframe, Timeframe>> = { '5m': '1h', '15m': '1h' };

export interface BacktestSettings {
    minStopDistancePercent: number;
    maxRiskRewardRatio: number;
    /** Defaults to the live scanner's 1:2. */
    minRiskReward?: number;
    /** Shallower entry, as a percent of price outside the origin zone. Defaults to none. */
    entryOffsetPercent?: number;
}

export interface MarketBacktestInput {
    coin: string;
    timeframe: Timeframe;
    /** Closed candles, oldest first. */
    candles: readonly Candle[];
    /** Closed 1h candles for the 5m/15m range filter, oldest first. */
    higherTimeframeCandles?: readonly Candle[];
    settings: BacktestSettings;
}

interface OpenPlan {
    signal: ChainSignal;
    filled: boolean;
    closestApproachPercent?: number;
}

export interface MarketBacktest {
    readonly input: MarketBacktestInput;
    /** Index of the next candle to replay. */
    index: number;
    readonly results: OutcomeHistoryItem[];
    /** Plans the scanner cancelled before entry: expired or closed through. */
    invalidated: number;
    /** Candles that touched both entry and target before a fill, counted as missed. */
    ambiguous: number;
    strategy: ChainStrategyState;
    open: OpenPlan[];
    higherIndex: number;
}

export function createMarketBacktest(input: MarketBacktestInput): MarketBacktest {
    return {
        input,
        // The scanner needs history before its first verdict means anything.
        index: Math.min(BACKTEST_WINDOW - 1, input.candles.length),
        results: [],
        invalidated: 0,
        ambiguous: 0,
        strategy: { zones: [], events: [], signals: [] },
        open: [],
        higherIndex: 0,
    };
}

export function isMarketBacktestDone(backtest: MarketBacktest): boolean {
    return backtest.index >= backtest.input.candles.length;
}

/** Plans still waiting for entry or still in a trade when the candles ran out. */
export function countOpenPlans(backtest: MarketBacktest): number {
    return backtest.open.length;
}

function toResult(
    plan: OpenPlan,
    outcome: OutcomeHistoryItem['outcome'],
    closedAt: number
): OutcomeHistoryItem {
    const { signal } = plan;
    const stopDistancePercent = (Math.abs(signal.entryPrice - signal.stopLoss) / signal.entryPrice) * 100;
    return {
        signalId: signal.id,
        coin: signal.coin,
        timeframe: signal.timeframe,
        direction: signal.direction,
        outcome,
        rMultiple: outcome === 'WIN' ? signal.riskRewardRatio : outcome === 'LOSS' ? -1 : 0,
        closedAt,
        stopDistancePercent,
        missedByR: outcome === 'MISSED' && plan.closestApproachPercent !== undefined
            ? plan.closestApproachPercent / stopDistancePercent
            : undefined,
    };
}

/**
 * Applies one closed candle to a plan. A candle only shows its range, not the
 * order prices traded in, so every tie is settled against the trader: stop
 * before target once filled, and entry-plus-target in one candle is a miss.
 */
function settlePlan(
    plan: OpenPlan,
    candle: Candle,
    closedAt: number,
    backtest: MarketBacktest
): OutcomeHistoryItem | null {
    const { signal } = plan;
    const long = signal.direction === 'LONG';
    const touchesEntry = long ? candle.low <= signal.entryPrice : candle.high >= signal.entryPrice;
    const touchesStop = long ? candle.low <= signal.stopLoss : candle.high >= signal.stopLoss;
    const touchesTarget = long ? candle.high >= signal.takeProfit : candle.low <= signal.takeProfit;

    if (plan.filled) {
        if (touchesStop) return toResult(plan, 'LOSS', closedAt);
        return touchesTarget ? toResult(plan, 'WIN', closedAt) : null;
    }

    if (touchesEntry) {
        if (touchesStop) return toResult(plan, 'LOSS', closedAt);
        if (touchesTarget) {
            backtest.ambiguous += 1;
            return toResult(plan, 'MISSED', closedAt);
        }
        plan.filled = true;
        return null;
    }

    // Measured before the miss is settled, so a plan missed on its first candle still has a gap.
    const nearest = long ? candle.low : candle.high;
    const approachPercent = (Math.abs(nearest - signal.entryPrice) / signal.entryPrice) * 100;
    plan.closestApproachPercent = Math.min(plan.closestApproachPercent ?? Infinity, approachPercent);
    return touchesTarget ? toResult(plan, 'MISSED', closedAt) : null;
}

/** Tells the scanner a plan left the waiting state, so it neither cancels nor reissues it. */
function markInStrategy(backtest: MarketBacktest, signalId: string, patch: Partial<ChainSignal>): void {
    backtest.strategy.signals = backtest.strategy.signals.map((signal) =>
        signal.id === signalId ? { ...signal, ...patch } : signal);
}

/**
 * Replays up to `steps` more candles: settles open plans against each candle,
 * then runs the live scanner on the window ending at that candle's close.
 * Returns true when the market is finished.
 */
export function advanceMarketBacktest(backtest: MarketBacktest, steps: number): boolean {
    const { coin, timeframe, candles, higherTimeframeCandles, settings } = backtest.input;
    const duration = getTimeframeMs(timeframe);
    const higherTimeframe = HIGHER_TIMEFRAME[timeframe];
    const higherDuration = higherTimeframe ? getTimeframeMs(higherTimeframe) : 0;
    const end = Math.min(candles.length, backtest.index + Math.max(0, steps));

    for (; backtest.index < end; backtest.index++) {
        const candle = candles[backtest.index];
        const now = candle.time + duration;

        backtest.open = backtest.open.filter((plan) => {
            // A plan is live from the close of its break candle onward.
            if (candle.time < plan.signal.createdAt) return true;

            const wasFilled = plan.filled;
            const result = settlePlan(plan, candle, now, backtest);
            if (result) {
                backtest.results.push(result);
                markInStrategy(backtest, plan.signal.id, result.outcome === 'MISSED'
                    ? { status: 'MISSED', closedAt: now }
                    : { status: 'TOUCHED', outcome: result.outcome, closedAt: now });
                return false;
            }
            if (plan.filled && !wasFilled) {
                markInStrategy(backtest, plan.signal.id, { status: 'TOUCHED', touchedAt: now });
            }
            return true;
        });

        let higherWindow: Candle[] | undefined;
        if (higherTimeframe && higherTimeframeCandles) {
            while (
                backtest.higherIndex < higherTimeframeCandles.length &&
                higherTimeframeCandles[backtest.higherIndex].time + higherDuration <= now
            ) {
                backtest.higherIndex += 1;
            }
            higherWindow = higherTimeframeCandles.slice(
                Math.max(0, backtest.higherIndex - BACKTEST_WINDOW),
                backtest.higherIndex
            );
        }

        const scan = scanForSignals(
            candles.slice(Math.max(0, backtest.index + 1 - BACKTEST_WINDOW), backtest.index + 1),
            coin,
            timeframe,
            backtest.strategy,
            {
                higherTimeframe,
                higherTimeframeCandles: higherWindow,
                minRiskReward: settings.minRiskReward ?? 2,
                minStopDistancePercent: settings.minStopDistancePercent,
                maxRiskRewardRatio: settings.maxRiskRewardRatio,
                entryOffsetPercent: settings.entryOffsetPercent,
                now,
            }
        );
        backtest.strategy = scan.state;

        const cancelled = new Set(scan.invalidatedSignals.map((signal) => signal.id));
        if (cancelled.size > 0) {
            const before = backtest.open.length;
            backtest.open = backtest.open.filter((plan) => plan.filled || !cancelled.has(plan.signal.id));
            backtest.invalidated += before - backtest.open.length;
        }
        for (const signal of scan.newSignals) {
            backtest.open.push({ signal, filled: false });
        }
    }

    return isMarketBacktestDone(backtest);
}
