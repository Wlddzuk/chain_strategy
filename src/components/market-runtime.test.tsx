// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getAllMids, getCandleSnapshot, getSizeDecimals } from '@/lib/api/hyperliquid-client';
import { useTradingStore } from '@/store/trading-store';
import MarketRuntime from './market-runtime';

vi.mock('@/lib/api/hyperliquid-client', () => ({ getAllMids: vi.fn(), getCandleSnapshot: vi.fn(), getSizeDecimals: vi.fn() }));
const initial = useTradingStore.getState();
beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 8, 7, 8, 0, 10));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useTradingStore.setState({ ...initial, availableCoins: ['BTC'], selectedCoin: 'BTC', selectedTimeframe: '1h', sizeDecimals: { BTC: 5 } });
    vi.mocked(getAllMids).mockResolvedValue({});
    vi.mocked(getSizeDecimals).mockResolvedValue({ BTC: 5 });
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); useTradingStore.setState(initial); });

it('retries a failed background scan within the same candle boundary without hammering the API', async () => {
    vi.mocked(getCandleSnapshot).mockRejectedValueOnce(new Error('Temporary outage')).mockResolvedValue([]);
    render(createElement(MarketRuntime, { enabled: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getCandleSnapshot).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(29_000); });
    expect(getCandleSnapshot).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(getCandleSnapshot).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(getCandleSnapshot).toHaveBeenCalledTimes(2);
});

it('keeps scanning for new setups while the tab is hidden', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    vi.mocked(getCandleSnapshot).mockResolvedValue([]);
    render(createElement(MarketRuntime, { enabled: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getCandleSnapshot).toHaveBeenCalled();
});
