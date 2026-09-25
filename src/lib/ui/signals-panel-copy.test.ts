import { describe, expect, it } from 'vitest';
import { getChartScopeEmptyState } from './signals-panel-copy';

describe('chart-scoped signal empty state', () => {
    it('explains where the all-markets KPI signals are and enables View all', () => {
        expect(getChartScopeEmptyState('BTC', '5m', 6)).toEqual({
            message: 'No signals for BTC 5m — 6 active in other markets',
            canViewAll: true,
        });
    });
});
