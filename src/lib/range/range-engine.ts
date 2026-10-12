import { detectEngulfingPatterns } from '@/lib/trading/pattern-detector';
import {
    getTimeframeMs,
    type Candle,
    type Timeframe,
    type Zone,
} from '@/lib/trading/types';
import type { OutcomeHistoryItem } from '@/lib/ui/strategy-record';

export interface RangeParams {
    /** A swing high or low must be the extreme of this many candles before it. */
    pivotLookback: number;
    /** ...and of this many candles after it, which is how long the app waits to be sure. */
    pivotConfirm: number;
    /** Smallest distance between the two entry levels, as a percent of price. */
    minRangePercent: number;
    /** Largest such distance. Wider than this is a trend leg, not a range. */
    maxRangePercent: number;
    /** Entries sit this far inside the range from the swing line, as a percent of price. */
    entryInsetPercent: number;
    /** Stops sit this far outside the swing line. A candle closing beyond the stop ends the range. */
    stopBufferPercent: number;
    /** Only accept a swing that printed an engulfing candle as it turned. */
    requireEngulfing: boolean;
}

export const DEFAULT_RANGE_PARAMS: RangeParams = {
    pivotLookback: 30,
    pivotConfirm: 5,
    minRangePercent: 5,
    maxRangePercent: 30,
    entryInsetPercent: 1.5,
    stopBufferPercent: 1.5,
    requireEngulfing: false,
};

/** How many candles either side of a swing an engulfing candle may print and still confirm it. */
const ENGULFING_REACH = 3;

export interface TradingRange {
    /** Band under the swing high: the far edge is the high itself, the near edge is the short entry. */
    top: Zone;
    /** Band over the swing low: the far edge is the low itself, the near edge is the long entry. */
    bottom: Zone;
    confirmedAt: number;
    /** Set once a candle closes beyond either side's stop level. */
    endedAt?: number;
}

export interface RangeTrade {
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    riskReward: number;
    openedAt: number;
    outcome?: 'WIN' | 'LOSS';
    closedAt?: number;
}

export interface RangeReplay {
    /** Every range found, oldest first. The last one is still live when it has no endedAt. */
    ranges: TradingRange[];
    /** Every trade taken, oldest first. The last one is still open when it has no outcome. */
    trades: RangeTrade[];
    activeRange: TradingRange | null;
    openTrade: RangeTrade | null;
    /** Whether a return to each zone would open a trade right now. */
    armed: { short: boolean; long: boolean };
}

/** Where a trade on this side of the range is stopped; a close beyond it also ends the range. */
function stopLevel(zone: Zone, params: RangeParams): number {
    const sign = zone.type === 'SUPPLY' ? 1 : -1;
    return zone.distalLine * (1 + (sign * params.stopBufferPercent / 100));
}

/** The trade a return to one side of the range opens: entry, stop, and target. */
export function planRangeTrade(
    direction: RangeTrade['direction'],
    range: TradingRange,
    openedAt: number,
    params: RangeParams
): RangeTrade {
    const long = direction === 'LONG';
    const zone = long ? range.bottom : range.top;
    const entryPrice = zone.proximalLine;
    const stopLoss = stopLevel(zone, params);
    // Profit is taken where the opposite trade would be opened.
    const takeProfit = (long ? range.top : range.bottom).proximalLine;

    return {
        direction,
        entryPrice,
        stopLoss,
        takeProfit,
        riskReward: Math.abs(takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss),
        openedAt,
    };
}

/**
 * The swing at `pivotIndex`, if its candle is the extreme of the lookback
 * before it (reaching back at least to `since`) and of every candle after it up
 * to `index`. Returned as a band from the swing line to the entry level.
 */
function findSwing(
    candles: readonly Candle[],
    type: Zone['type'],
    pivotIndex: number,
    index: number,
    since: number | null,
    params: RangeParams
): Zone | null {
    const pivot = candles[pivotIndex];
    const supply = type === 'SUPPLY';
    const extreme = supply ? pivot.high : pivot.low;
    const from = Math.max(0, Math.min(pivotIndex - params.pivotLookback, since ?? pivotIndex));
    for (let other = from; other <= index; other++) {
        if (other === pivotIndex) continue;
        if (supply ? candles[other].high > extreme : candles[other].low < extreme) return null;
    }

    if (params.requireEngulfing) {
        const start = Math.max(0, pivotIndex - ENGULFING_REACH);
        const wanted = supply ? 'BEARISH' : 'BULLISH';
        const turned = detectEngulfingPatterns(candles.slice(start, Math.min(index, pivotIndex + ENGULFING_REACH) + 1))
            .some((pattern) => pattern.type === wanted);
        if (!turned) return null;
    }

    return {
        id: `range-${type}-${pivot.time}`,
        type,
        proximalLine: extreme * (1 + ((supply ? -1 : 1) * params.entryInsetPercent / 100)),
        distalLine: extreme,
        createdAt: pivot.time,
        createdAtIndex: pivotIndex,
        status: 'ACTIVE',
        strength: 70,
        originCandle: pivot,
    };
}

/**
 * Replays the range strategy over closed candles, oldest first.
 *
 * A range is a swing high above a swing low. Inside it the strategy shorts
 * each return to the high and buys each return to the low, entering just inside
 * the line, stopping just outside it, and taking profit where the opposite
 * trade would open. A candle closing beyond a stop level ends the range.
 *
 * Every decision uses only candles up to the one being replayed; a swing is
 * known `pivotConfirm` candles after it prints. A candle shows its range, not
 * the order prices traded in, so ties go against the trader.
 */
export function replayRange(
    candles: readonly Candle[],
    timeframe: Timeframe,
    params: RangeParams = DEFAULT_RANGE_PARAMS
): RangeReplay {
    const duration = getTimeframeMs(timeframe);
    const ranges: TradingRange[] = [];
    const trades: RangeTrade[] = [];
    let topCandidate: Zone | null = null;
    let bottomCandidate: Zone | null = null;
    let activeRange: TradingRange | null = null;
    let openTrade: RangeTrade | null = null;
    let armedShort = false;
    let armedLong = false;

    for (let index = 1; index < candles.length; index++) {
        const candle = candles[index];
        const closeTime = candle.time + duration;

        const settle = (trade: RangeTrade): boolean => {
            const long = trade.direction === 'LONG';
            const stopped = long ? candle.low <= trade.stopLoss : candle.high >= trade.stopLoss;
            const reachedTarget = long ? candle.high >= trade.takeProfit : candle.low <= trade.takeProfit;
            if (!stopped && !reachedTarget) return false;
            trade.outcome = stopped ? 'LOSS' : 'WIN';
            trade.closedAt = closeTime;
            return true;
        };

        let stoppedThisCandle = false;
        if (openTrade && settle(openTrade)) {
            stoppedThisCandle = openTrade.outcome === 'LOSS';
            openTrade = null;
        }

        // After a stop the zone must be reclaimed first; re-entering inside the
        // candle that ran the stop would be buying a level price has already left.
        if (activeRange && !openTrade && !stoppedThisCandle) {
            const reachesTop = candle.high >= activeRange.top.proximalLine;
            const reachesBottom = candle.low <= activeRange.bottom.proximalLine;
            // One candle crossing the whole range cannot be ordered; stand aside.
            const direction = reachesTop && reachesBottom
                ? null
                : reachesTop && armedShort
                    ? 'SHORT'
                    : reachesBottom && armedLong
                        ? 'LONG'
                        : null;
            if (direction) {
                const trade = planRangeTrade(direction, activeRange, candle.time, params);
                trades.push(trade);
                if (direction === 'SHORT') armedShort = false;
                else armedLong = false;
                // The entry candle can also run through the stop.
                const stopped = direction === 'LONG'
                    ? candle.low <= trade.stopLoss
                    : candle.high >= trade.stopLoss;
                if (stopped) {
                    trade.outcome = 'LOSS';
                    trade.closedAt = closeTime;
                } else {
                    openTrade = trade;
                }
            }
        }

        if (activeRange) {
            // A side re-arms once price closes back inside the range, away from its entry level.
            if (candle.close < activeRange.top.proximalLine) armedShort = true;
            if (candle.close > activeRange.bottom.proximalLine) armedLong = true;

            const brokeTop: boolean = candle.close > stopLevel(activeRange.top, params);
            const brokeBottom: boolean = candle.close < stopLevel(activeRange.bottom, params);
            if (brokeTop || brokeBottom) {
                // The side that held can anchor the next range once a new opposite extreme forms.
                topCandidate = brokeTop ? null : activeRange.top;
                bottomCandidate = brokeBottom ? null : activeRange.bottom;
                activeRange.endedAt = closeTime;
                activeRange = null;
            }
            continue;
        }

        if (topCandidate && candle.close > stopLevel(topCandidate, params)) topCandidate = null;
        if (bottomCandidate && candle.close < stopLevel(bottomCandidate, params)) bottomCandidate = null;

        const pivotIndex = index - params.pivotConfirm;
        if (pivotIndex >= 0) {
            // Each new swing must also be the extreme since the one it would pair with.
            const swingHigh = findSwing(candles, 'SUPPLY', pivotIndex, index, bottomCandidate?.createdAtIndex ?? null, params);
            if (swingHigh) topCandidate = swingHigh;
            const swingLow = findSwing(candles, 'DEMAND', pivotIndex, index, topCandidate?.createdAtIndex ?? null, params);
            if (swingLow) bottomCandidate = swingLow;
        }

        const heightPercent = topCandidate && bottomCandidate
            ? ((topCandidate.proximalLine - bottomCandidate.proximalLine) / bottomCandidate.proximalLine) * 100
            : 0;
        if (
            topCandidate &&
            bottomCandidate &&
            candle.close < topCandidate.proximalLine &&
            candle.close > bottomCandidate.proximalLine &&
            heightPercent >= params.minRangePercent &&
            heightPercent <= params.maxRangePercent
        ) {
            activeRange = { top: topCandidate, bottom: bottomCandidate, confirmedAt: closeTime };
            ranges.push(activeRange);
            armedShort = true;
            armedLong = true;
        }
    }

    return {
        ranges,
        trades,
        activeRange,
        openTrade,
        // Only one trade runs at a time, so nothing is armed while one is open.
        armed: {
            short: activeRange !== null && openTrade === null && armedShort,
            long: activeRange !== null && openTrade === null && armedLong,
        },
    };
}

/** Finished range trades in the shape the strategy record understands. */
export function toRangeHistory(
    trades: readonly RangeTrade[],
    coin: string,
    timeframe: Timeframe
): OutcomeHistoryItem[] {
    return trades.flatMap((trade): OutcomeHistoryItem[] => {
        if (!trade.outcome || trade.closedAt === undefined) return [];
        return [{
            signalId: `range:${coin}:${timeframe}:${trade.direction}:${trade.openedAt}`,
            coin,
            timeframe,
            direction: trade.direction,
            outcome: trade.outcome,
            rMultiple: trade.outcome === 'WIN' ? trade.riskReward : -1,
            closedAt: trade.closedAt,
            stopDistancePercent: (Math.abs(trade.entryPrice - trade.stopLoss) / trade.entryPrice) * 100,
        }];
    });
}
