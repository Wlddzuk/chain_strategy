import { afterEach, describe, expect, it, vi } from 'vitest';
import { MARKET_REQUEST_TIMEOUT_MS, requestInfo } from './request-info';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function stalledFetch() {
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    })));
}

describe('market request deadlines', () => {
    it('aborts a stalled request instead of leaving the dashboard loading forever', async () => {
        vi.useFakeTimers();
        stalledFetch();
        const result = expect(requestInfo({ type: 'allMids' })).rejects.toMatchObject({ name: 'TimeoutError' });
        await vi.advanceTimersByTimeAsync(MARKET_REQUEST_TIMEOUT_MS);
        await result;
    });

    it('cancels immediately when the selected market changes', async () => {
        stalledFetch();
        const controller = new AbortController();
        const result = expect(requestInfo({ type: 'allMids' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
        controller.abort();
        await result;
    });
});
