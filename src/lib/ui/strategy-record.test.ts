import { describe, expect, it } from 'vitest';
import type { ChainSignal } from '@/lib/trading/types';
import {
    appendOutcomeHistory,
    backfillStopDistances,
    calculateMissedPlanStats,
    calculateStrategyBreakdown,
    calculateStrategyRecord,
    getStrategyRecordWarning,
    hasEnoughResolvedPlansForPercentage,
    LOW_SAMPLE_WARNING,
    OUTCOME_HISTORY_LIMIT,
    type OutcomeHistoryItem,
} from './strategy-record';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 50 * DAY_MS;

function signal(
    id: string,
    status: ChainSignal['status'] = 'PENDING',
    overrides: Partial<ChainSignal> = {}
): ChainSignal {
    return {
        id,
        coin: 'BTC',
        timeframe: '1h',
        phase: 'ENTRY',
        direction: 'LONG',
        eventZone: {} as ChainSignal['eventZone'],
        originZone: {} as ChainSignal['originZone'],
        entryPrice: 100,
        stopLoss: 99,
        takeProfit: 103,
        riskRewardRatio: 3,
        confidence: 80,
        hasRsiDivergence: false,
        createdAt: NOW - DAY_MS,
        expiresAt: NOW + DAY_MS,
        status,
        ...overrides,
    };
}

function historyItem(
    signalId: string,
    outcome: OutcomeHistoryItem['outcome'],
    closedAt: number,
    rMultiple = outcome === 'WIN' ? 3 : outcome === 'LOSS' ? -1 : 0
): OutcomeHistoryItem {
    return {
        signalId,
        coin: 'BTC',
        timeframe: '1h',
        direction: 'LONG',
        outcome,
        rMultiple,
        closedAt,
    };
}

describe('appendOutcomeHistory', () => {
    it('appends outcome and MISSED transitions with their planned R multiples', () => {
        const previous = [signal('win'), signal('loss', 'FILLED'), signal('missed')];
        const next = [
            signal('win', 'TOUCHED', { outcome: 'WIN', closedAt: NOW, riskRewardRatio: 2.5 }),
            signal('loss', 'FILLED', { outcome: 'LOSS', closedAt: NOW + 1 }),
            signal('missed', 'MISSED', { closedAt: NOW + 2 }),
        ];

        expect(appendOutcomeHistory([], previous, next)).toMatchObject([
            historyItem('win', 'WIN', NOW, 2.5),
            historyItem('loss', 'LOSS', NOW + 1),
            historyItem('missed', 'MISSED', NOW + 2),
        ]);
    });

    it('deduplicates already-recorded signals and preserves identity when nothing changes', () => {
        const completed = signal('win', 'FILLED', { outcome: 'WIN', closedAt: NOW });
        const existing = [historyItem('win', 'WIN', NOW)];

        const result = appendOutcomeHistory(existing, [completed], [completed]);

        expect(result).toBe(existing);
        expect(result).toHaveLength(1);
    });

    it('keeps only the newest 500 unique history items', () => {
        const existing = Array.from({ length: OUTCOME_HISTORY_LIMIT }, (_, index) =>
            historyItem(`old-${index}`, 'WIN', index)
        );
        const next = signal('new', 'MISSED', { closedAt: NOW });

        const result = appendOutcomeHistory(existing, [signal('new')], [next]);

        expect(result).toHaveLength(OUTCOME_HISTORY_LIMIT);
        expect(result[0].signalId).toBe('old-1');
        expect(result.at(-1)?.signalId).toBe('new');
    });
});

describe('calculateStrategyRecord', () => {
    const history = [
        historyItem('recent-win', 'WIN', NOW - DAY_MS, 3),
        historyItem('boundary-loss', 'LOSS', NOW - 7 * DAY_MS),
        historyItem('older-win', 'WIN', NOW - 8 * DAY_MS, 2),
        historyItem('month-miss', 'MISSED', NOW - 20 * DAY_MS),
        historyItem('old-loss', 'LOSS', NOW - 40 * DAY_MS),
    ];

    it('aggregates 7d, 30d, and all windows with inclusive boundaries', () => {
        expect(calculateStrategyRecord(history, '7d', NOW)).toMatchObject({
            resolved: 2,
            wins: 1,
            losses: 1,
            winRate: null,
            grossR: 2,
            missed: 0,
        });
        expect(calculateStrategyRecord(history, '30d', NOW)).toMatchObject({
            resolved: 3,
            wins: 2,
            losses: 1,
            grossR: 4,
            missed: 1,
        });
        expect(calculateStrategyRecord(history, 'all', NOW)).toMatchObject({
            resolved: 4,
            wins: 2,
            losses: 2,
            grossR: 3,
            missed: 1,
        });
    });

    it('hides percentages below five resolved plans and warns below ten', () => {
        const fourResults = Array.from({ length: 4 }, (_, index) =>
            historyItem(`four-${index}`, index < 3 ? 'WIN' : 'LOSS', NOW)
        );
        const fiveResults = [...fourResults, historyItem('fifth', 'LOSS', NOW)];
        const tenResults = Array.from({ length: 10 }, (_, index) =>
            historyItem(`ten-${index}`, index < 6 ? 'WIN' : 'LOSS', NOW)
        );

        expect(calculateStrategyRecord(fourResults, 'all', NOW)).toMatchObject({
            winRate: null,
            showWinRate: false,
            isLowSample: true,
        });
        expect(calculateStrategyRecord(fiveResults, 'all', NOW)).toMatchObject({
            winRate: 60,
            showWinRate: true,
            isLowSample: true,
        });
        expect(calculateStrategyRecord(tenResults, 'all', NOW)).toMatchObject({
            winRate: 60,
            showWinRate: true,
            isLowSample: false,
        });
        expect(hasEnoughResolvedPlansForPercentage(4)).toBe(false);
        expect(hasEnoughResolvedPlansForPercentage(5)).toBe(true);
        expect(getStrategyRecordWarning(9)).toBe(LOW_SAMPLE_WARNING);
        expect(getStrategyRecordWarning(10)).toBeNull();
    });

    it('charges Hyperliquid fees in R, scaled by each trade\'s stop size', () => {
        const fees = { makerFeePercent: 0.015, takerFeePercent: 0.045 };
        const priced = [
            { ...historyItem('win', 'WIN', NOW, 3), stopDistancePercent: 0.5 },
            { ...historyItem('loss', 'LOSS', NOW), stopDistancePercent: 1 },
        ];

        const record = calculateStrategyRecord(priced, 'all', NOW, fees);

        expect(record.grossR).toBe(2);
        // Win: 0.03% / 0.5% = 0.06R. Loss: 0.06% / 1% = 0.06R.
        expect(record.netR).toBeCloseTo(2 - 0.06 - 0.06);
        expect(record.feeEstimatedCount).toBe(0);
    });

    it('prices older trades from the median stop and reports no net R without any stop data', () => {
        const fees = { makerFeePercent: 0.015, takerFeePercent: 0.045 };
        const legacyLoss = historyItem('legacy-loss', 'LOSS', NOW);
        const mixed = [
            { ...historyItem('win', 'WIN', NOW, 3), stopDistancePercent: 0.6 },
            legacyLoss,
        ];

        const record = calculateStrategyRecord(mixed, 'all', NOW, fees);
        expect(record.netR).toBeCloseTo(2 - (0.03 / 0.6) - (0.06 / 0.6));
        expect(record.feeEstimatedCount).toBe(1);

        expect(calculateStrategyRecord([legacyLoss], 'all', NOW, fees)).toMatchObject({
            grossR: -1,
            netR: null,
            feeEstimatedCount: 0,
        });
    });
});

describe('backfillStopDistances', () => {
    it('fills missing stop sizes from saved signals and keeps identity when nothing is missing', () => {
        const legacy = [historyItem('kept', 'WIN', NOW), historyItem('rotated-out', 'LOSS', NOW)];

        const filled = backfillStopDistances(legacy, [signal('kept', 'TOUCHED')]);

        expect(filled[0].stopDistancePercent).toBeCloseTo(1);
        expect(filled[1].stopDistancePercent).toBeUndefined();

        const complete = [{ ...legacy[0], stopDistancePercent: 1 }];
        expect(backfillStopDistances(complete, [])).toBe(complete);
    });
});

describe('calculateStrategyBreakdown', () => {
    const fees = { makerFeePercent: 0, takerFeePercent: 0 };
    const history: OutcomeHistoryItem[] = [
        { ...historyItem('btc-1h-win', 'WIN', NOW, 3), stopDistancePercent: 1 },
        { ...historyItem('eth-5m-loss', 'LOSS', NOW), coin: 'ETH', timeframe: '5m', direction: 'SHORT', stopDistancePercent: 1 },
        { ...historyItem('eth-5m-miss', 'MISSED', NOW), coin: 'ETH', timeframe: '5m', direction: 'SHORT' },
        { ...historyItem('old-4h-win', 'WIN', NOW - 40 * DAY_MS, 2), timeframe: '4h', stopDistancePercent: 1 },
    ];

    it('splits by timeframe, shortest first, within the window', () => {
        const rows = calculateStrategyBreakdown(history, 'timeframe', '30d', NOW, fees);

        expect(rows.map((row) => row.key)).toEqual(['5m', '1h']);
        expect(rows[0].record).toMatchObject({ wins: 0, losses: 1, missed: 1, netR: -1 });
        expect(rows[1].record).toMatchObject({ wins: 1, losses: 0, missed: 0, netR: 3 });
        expect(calculateStrategyBreakdown(history, 'timeframe', 'all', NOW, fees).map((row) => row.key))
            .toEqual(['5m', '1h', '4h']);
    });

    it('splits by coin and direction with the best R first', () => {
        expect(calculateStrategyBreakdown(history, 'coin', 'all', NOW, fees).map((row) => [row.key, row.record.netR]))
            .toEqual([['BTC', 5], ['ETH', -1]]);
        expect(calculateStrategyBreakdown(history, 'direction', 'all', NOW, fees).map((row) => row.key))
            .toEqual(['LONG', 'SHORT']);
    });

    it('charges each group the same fees the total record does', () => {
        const hyperliquid = { makerFeePercent: 0.015, takerFeePercent: 0.045 };
        const rows = calculateStrategyBreakdown(history, 'coin', 'all', NOW, hyperliquid);
        const total = calculateStrategyRecord(history, 'all', NOW, hyperliquid);

        expect(rows.reduce((sum, row) => sum + (row.record.netR ?? 0), 0)).toBeCloseTo(total.netR ?? 0);
    });
});

describe('missed plan tracking', () => {
    it('saves how near price came to a missed entry, in R', () => {
        const before = [signal('missed')];
        const after = [signal('missed', 'MISSED', { closedAt: NOW, closestEntryApproachPercent: 0.25 })];

        // The fixture stop is 1% from entry, so 0.25% away is 0.25R.
        expect(appendOutcomeHistory([], before, after)[0].missedByR).toBeCloseTo(0.25);
    });

    it('counts near misses and the median gap among tracked missed plans', () => {
        const missedItem = (id: string, missedByR?: number, closedAt = NOW): OutcomeHistoryItem => ({
            ...historyItem(id, 'MISSED', closedAt),
            missedByR,
        });
        const history = [
            missedItem('near', 0.1),
            missedItem('edge', 0.25),
            missedItem('far', 1.5),
            missedItem('untracked'),
            missedItem('old', 0.05, NOW - 40 * DAY_MS),
            historyItem('win', 'WIN', NOW),
        ];

        expect(calculateMissedPlanStats(history, '30d', NOW)).toEqual({
            missed: 4,
            tracked: 3,
            nearMisses: 2,
            medianMissedByR: 0.25,
        });
        expect(calculateMissedPlanStats([], 'all', NOW)).toEqual({
            missed: 0, tracked: 0, nearMisses: 0, medianMissedByR: null,
        });
    });
});
