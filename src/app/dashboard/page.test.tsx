// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getAllMids, getCandleSnapshot } from '@/lib/api/hyperliquid-client';
import { subscribeToHyperliquidCandles } from '@/lib/api/hyperliquid-ws';
import { useTradingStore } from '@/store/trading-store';
import Dashboard from './page';

vi.mock('@/lib/api/hyperliquid-client', () => ({ getAllMids: vi.fn(), getCandleSnapshot: vi.fn(), getEquity: vi.fn() }));
vi.mock('@/lib/api/hyperliquid-ws', () => ({ subscribeToHyperliquidCandles: vi.fn(() => () => undefined) }));
vi.mock('@/components/chart-panel', () => ({ default: ({ isLoading, error }: { isLoading: boolean; error: string | null }) => createElement('div', { role: 'status' }, isLoading ? 'Loading' : error ?? 'Chart ready') }));
vi.mock('@/components/dashboard-header', () => ({ DashboardHeader: () => null }));
vi.mock('@/components/now-bar', () => ({ NowBar: () => null }));
vi.mock('@/components/market-runtime', () => ({ default: () => null }));
vi.mock('@/components/current-price-card', () => ({ default: () => null }));
vi.mock('@/components/active-signals-card', () => ({ default: () => null }));
vi.mock('@/components/trading-context-card', () => ({ default: () => null }));
vi.mock('@/components/signals-panel', () => ({ default: () => null }));
vi.mock('@/components/settings-panel', () => ({ default: () => null }));
vi.mock('@/components/alert-toast-host', () => ({ default: () => null }));
vi.mock('@/components/trading-alert-runtime', () => ({ default: () => null }));

const initial = useTradingStore.getState();
beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useTradingStore.setState({ ...initial, selectedCoin: 'BTC', selectedTimeframe: '1h' });
    vi.mocked(getAllMids).mockResolvedValue({ BTC: 100 });
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); useTradingStore.setState(initial); });

it('recovers the chart automatically after the initial market request fails', async () => {
    vi.mocked(getCandleSnapshot).mockRejectedValueOnce(new Error('Temporary outage')).mockResolvedValue([
        { time: Date.now() - 3_600_000, open: 100, high: 101, low: 99, close: 100, volume: 10 },
    ]);
    render(createElement(Dashboard));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('status').textContent).toContain('unavailable');
    expect(subscribeToHyperliquidCandles).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByRole('status').textContent).toBe('Chart ready');
    expect(subscribeToHyperliquidCandles).toHaveBeenCalledTimes(1);
});
