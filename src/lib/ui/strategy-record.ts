import type {
    ChainSignal,
    SignalOutcome,
    Timeframe,
} from '@/lib/trading/types';

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
}

export interface StrategyRecord {
    resolved: number;
    wins: number;
    losses: number;
    winRate: number | null;
    netR: number;
    missed: number;
    showWinRate: boolean;
    isLowSample: boolean;
}

function getHistoryResult(signal: ChainSignal): OutcomeHistoryResult | null {
    if (signal.outcome === 'WIN' || signal.outcome === 'LOSS') return signal.outcome;
    return signal.status === 'MISSED' ? 'MISSED' : null;
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

export function hasEnoughResolvedPlansForPercentage(resolved: number): boolean {
    return Number.isFinite(resolved) && resolved >= MIN_RESOLVED_FOR_PERCENTAGE;
}

export function getStrategyRecordWarning(resolved: number): string | null {
    return Number.isFinite(resolved) && resolved >= MIN_RESOLVED_FOR_JUDGMENT
        ? null
        : LOW_SAMPLE_WARNING;
}

export function calculateStrategyRecord(
    history: readonly OutcomeHistoryItem[],
    recordWindow: StrategyRecordWindow,
    now: number
): StrategyRecord {
    const windowMs = recordWindow === '7d'
        ? 7 * DAY_MS
        : recordWindow === '30d'
            ? 30 * DAY_MS
            : Number.POSITIVE_INFINITY;
    const cutoff = Number.isFinite(now) && Number.isFinite(windowMs)
        ? now - windowMs
        : Number.NEGATIVE_INFINITY;

    let wins = 0;
    let losses = 0;
    let missed = 0;
    let netR = 0;

    for (const item of history) {
        if (!Number.isFinite(item.closedAt) || item.closedAt < cutoff) continue;

        if (item.outcome === 'WIN') {
            wins += 1;
            if (Number.isFinite(item.rMultiple)) netR += item.rMultiple;
        } else if (item.outcome === 'LOSS') {
            losses += 1;
            if (Number.isFinite(item.rMultiple)) netR += item.rMultiple;
        } else if (item.outcome === 'MISSED') {
            missed += 1;
        }
    }

    const resolved = wins + losses;
    const showWinRate = hasEnoughResolvedPlansForPercentage(resolved);

    return {
        resolved,
        wins,
        losses,
        winRate: showWinRate ? (wins / resolved) * 100 : null,
        netR,
        missed,
        showWinRate,
        isLowSample: getStrategyRecordWarning(resolved) !== null,
    };
}
