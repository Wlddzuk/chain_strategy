export const MARKET_REQUEST_TIMEOUT_MS = 15_000;

/** Bound both response and body reads; preserve caller cancellation on navigation. */
export async function requestInfo<T>(body: object, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => {
        controller.abort(new DOMException('Market data request timed out', 'TimeoutError'));
    }, MARKET_REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
            body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`Hyperliquid request failed (${response.status}): ${response.statusText}`);
        return await response.json() as T;
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
    }
}
