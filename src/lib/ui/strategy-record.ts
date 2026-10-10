import {
    getTimeframeMs,
    type ChainSignal,
    type SignalOutcome,
    type Timeframe,
} from '@/lib/trading/types';
import { getPlanFeePercents, HYPERLIQUID_BASE_FEES, type FeeRates } from '@/lib/ui/trade-metrics';

export const OUTCOME_HISTORY_LIMIT = 500;
export const MIN_RESOLVED_FOR_PERCENTAGE = 5;
export const MIN_RESOLVED_FOR_JUDGMENT = 10;
export const LOW_SAMPLE_WARNING = 'Too little data to judge — let the scanner watch for a few weeks first.';

const DAY_MS = 24 * 60 * 60 * 1000;

export type OutcomeHistoryResult = SignalOutcome | 'MISSED';
export type StrategyRecordWindow = '7d' | '30d' | 'all';

export interface OutcomeHistoryItem {
    signalId: string;
    coin: string;
    timeframe: Timeframe;
    direction: ChainSignal['direction'];
    outcome: OutcomeHistoryResult;
    rMultiple: number;
    closedAt: number;
    /** Entry-to-stop distance in percent. Missing on items saved before fees were tracked. */
    stopDistancePercent?: number;
}

export interface StrategyRecord {
    resolved: number;
    wins: number;
    losses: number;
    winRate: number | null;
    grossR: number;
    /** Total R after fees, or null when no trade has a saved stop size to price fees from. */
    netR: number | null;
    /** Resolved trades whose fees were priced from the median stop of the others. */
    feeEstimatedCount: number;
    missed: number;
    showWinRate: boolean;
    isLowSample: boolean;
}

function getHistoryResult(signal: ChainSignal): OutcomeHistoryResult | null {
    if (signal.outcome === 'WIN' || signal.outcome === 'LOSS') return signal.outcome;
    return signal.status === 'MISSED' ? 'MISSED' : null;
}

function getStopDistancePercent(signal: ChainSignal): number | undefined {
    const distance = (Math.abs(signal.entryPrice - signal.stopLoss) / signal.entryPrice) * 100;
    return Number.isFinite(distance) && distance > 0 ? distance : undefined;
}

function toHistoryItem(signal: ChainSignal): OutcomeHistoryItem | null {
    const outcome = getHistoryResult(signal);
    const closedAt = signal.closedAt;
    if (outcome === null || !Number.isFinite(closedAt) || closedAt === undefined || closedAt < 0) {
        return null;
    }

    const winRMultiple = Number.isFinite(signal.riskRewardRatio)
        ? Math.max(0, signal.riskRewardRatio)
        : 0;

    return {
        signalId: signal.id,
        coin: signal.coin,
        timeframe: signal.timeframe,
        direction: signal.direction,
        outcome,
        rMultiple: outcome === 'WIN' ? winRMultiple : outcome === 'LOSS' ? -1 : 0,
        closedAt,
        stopDistancePercent: getStopDistancePercent(signal),
    };
}

function getHistoryKey(item: OutcomeHistoryItem): string {
    if (item.signalId) return item.signalId;
    return [
        item.coin,
        item.timeframe,
        item.direction,
        item.outcome,
        item.closedAt,
    ].join(':');
}

function normalizeHistory(history: readonly OutcomeHistoryItem[]): OutcomeHistoryItem[] {
    const byKey = new Map<string, OutcomeHistoryItem>();
    for (const item of history) byKey.set(getHistoryKey(item), item);
    return Array.from(byKey.values()).slice(-OUTCOME_HISTORY_LIMIT);
}

/**
 * Appends newly resolved or missed signal transitions without mutating inputs.
 * When there is nothing to append and the existing history is already valid,
 * the original history reference is returned to avoid per-price store churn.
 */
export function appendOutcomeHistory(
    previousHistory: OutcomeHistoryItem[],
    previousSignals: readonly ChainSignal[],
    nextSignals: readonly ChainSignal[]
): OutcomeHistoryItem[] {
    const previousById = new Map(previousSignals.map((signal) => [signal.id, signal]));
    const additions: OutcomeHistoryItem[] = [];

    for (const signal of nextSignals) {
        const nextResult = getHistoryResult(signal);
        if (nextResult === null) continue;

        const previousResult = getHistoryResult(previousById.get(signal.id) ?? signal);
        if (previousById.has(signal.id) && previousResult === nextResult) continue;

        const item = toHistoryItem(signal);
        if (item) additions.push(item);
    }

    const existingKeys = new Set<string>();
    let hasExistingDuplicate = false;
    for (const item of previousHistory) {
        const key = getHistoryKey(item);
        if (existingKeys.has(key)) hasExistingDuplicate = true;
        existingKeys.add(key);
    }

    const uniqueAdditions = additions.filter((item) => {
        const key = getHistoryKey(item);
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
    });

    if (
        uniqueAdditions.length === 0 &&
        !hasExistingDuplicate &&
        previousHistory.length <= OUTCOME_HISTORY_LIMIT
    ) {
        return previousHistory;
    }

    return normalizeHistory([...previousHistory, ...uniqueAdditions]);
}

/** Fills in stop sizes for older history items whose signal is still saved. */
export function backfillStopDistances(
    history: OutcomeHistoryItem[],
    signals: readonly ChainSignal[]
): OutcomeHistoryItem[] {
    if (history.every((item) => item.stopDistancePercent !== undefined)) return history;

    const stopBySignalId = new Map(
        signals.map((signal) => [signal.id, getStopDistancePercent(signal)])
    );
    return history.map((item) => item.stopDistancePercent === undefined
        ? { ...item, stopDistancePercent: stopBySignalId.get(item.signalId) }
        : item);
}

function getMedianStopDistancePercent(history: readonly OutcomeHistoryItem[]): number | null {
    const known = history
        .map((item) => item.stopDistancePercent)
        .filter((distance): distance is number =>
            distance !== undefined && Number.isFinite(distance) && distance > 0)
        .sort((first, second) => first - second);
    if (known.length === 0) return null;

    const middle = Math.floor(known.length / 2);
    return known.length % 2 === 1 ? known[middle] : (known[middle - 1] + known[middle]) / 2;
}

export function hasEnoughResolvedPlansForPercentage(resolved: number): boolean {
    return Number.isFinite(resolved) && resolved >= MIN_RESOLVED_FOR_PERCENTAGE;
}

export function getStrategyRecordWarning(resolved: number): string | null {
    return Number.isFinite(resolved) && resolved >= MIN_RESOLVED_FOR_JUDGMENT
        ? null
        : LOW_SAMPLE_WARNING;
}

function getWindowCutoff(recordWindow: StrategyRecordWindow, now: number): number {
    const windowMs = recordWindow === '7d'
        ? 7 * DAY_MS
        : recordWindow === '30d'
            ? 30 * DAY_MS
            : Number.POSITIVE_INFINITY;
    return Number.isFinite(now) && Number.isFinite(windowMs)
        ? now - windowMs
        : Number.NEGATIVE_INFINITY;
}

function isInWindow(item: OutcomeHistoryItem, cutoff: number): boolean {
    return Number.isFinite(item.closedAt) && item.closedAt >= cutoff;
}

/** medianStop prices fees for items saved without their own stop size. */
function summarizeRecord(
    items: readonly OutcomeHistoryItem[],
    fees: FeeRates,
    medianStop: number | null
): StrategyRecord {
    let wins = 0;
    let losses = 0;
    let missed = 0;
    let grossR = 0;
    let feeR = 0;
    let feeEstimatedCount = 0;
    const planFees = getPlanFeePercents(fees);

    for (const item of items) {
        if (item.outcome === 'MISSED') {
            missed += 1;
            continue;
        }
        if (item.outcome === 'WIN') wins += 1;
        else losses += 1;
        if (Number.isFinite(item.rMultiple)) grossR += item.rMultiple;

        // Fees are a fixed share of notional, so they cost more R the tighter the stop.
        const stop = item.stopDistancePercent ?? medianStop;
        if (item.stopDistancePercent === undefined) feeEstimatedCount += 1;
        if (stop !== null) feeR += (item.outcome === 'WIN' ? planFees.win : planFees.loss) / stop;
    }

    const resolved = wins + losses;
    const showWinRate = hasEnoughResolvedPlansForPercentage(resolved);

    return {
        resolved,
        wins,
        losses,
        winRate: showWinRate ? (wins / resolved) * 100 : null,
        grossR,
        netR: medianStop === null ? null : grossR - feeR,
        feeEstimatedCount: medianStop === null ? 0 : feeEstimatedCount,
        missed,
        showWinRate,
        isLowSample: getStrategyRecordWarning(resolved) !== null,
    };
}

export function calculateStrategyRecord(
    history: readonly OutcomeHistoryItem[],
    recordWindow: StrategyRecordWindow,
    now: number,
    fees: FeeRates = HYPERLIQUID_BASE_FEES
): StrategyRecord {
    const cutoff = getWindowCutoff(recordWindow, now);
    return summarizeRecord(
        history.filter((item) => isInWindow(item, cutoff)),
        fees,
        getMedianStopDistancePercent(history)
    );
}

export type StrategyBreakdownDimension = 'timeframe' | 'coin' | 'direction';

export interface StrategyBreakdownRow {
    key: string;
    record: StrategyRecord;
}

/**
 * Splits the windowed record by one dimension. Timeframes list shortest first;
 * coins and directions list best R first so the losers sink to the bottom.
 */
export function calculateStrategyBreakdown(
    history: readonly OutcomeHistoryItem[],
    dimension: StrategyBreakdownDimension,
    recordWindow: StrategyRecordWindow,
    now: number,
    fees: FeeRates = HYPERLIQUID_BASE_FEES
): StrategyBreakdownRow[] {
    const cutoff = getWindowCutoff(recordWindow, now);
    const groups = new Map<string, OutcomeHistoryItem[]>();
    for (const item of history) {
        if (!isInWindow(item, cutoff)) continue;
        const group = groups.get(item[dimension]);
        if (group) group.push(item);
        else groups.set(item[dimension], [item]);
    }

    const medianStop = getMedianStopDistancePercent(history);
    const rows = Array.from(groups, ([key, items]) => ({
        key,
        record: summarizeRecord(items, fees, medianStop),
    }));

    if (dimension === 'timeframe') {
        return rows.sort((first, second) =>
            getTimeframeMs(first.key as Timeframe) - getTimeframeMs(second.key as Timeframe));
    }
    return rows.sort((first, second) =>
        (second.record.netR ?? second.record.grossR) - (first.record.netR ?? first.record.grossR) ||
        first.key.localeCompare(second.key));
}
