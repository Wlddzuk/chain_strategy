import { describe, expect, it } from 'vitest';
import type { ChainSignal } from '@/lib/trading/types';
import {
    appendOutcomeHistory,
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

        expect(appendOutcomeHistory([], previous, next)).toEqual([
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
            netR: 2,
            missed: 0,
        });
        expect(calculateStrategyRecord(history, '30d', NOW)).toMatchObject({
            resolved: 3,
            wins: 2,
            losses: 1,
            netR: 4,
            missed: 1,
        });
        expect(calculateStrategyRecord(history, 'all', NOW)).toMatchObject({
            resolved: 4,
            wins: 2,
            losses: 2,
            netR: 3,
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
});
