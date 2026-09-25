import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STREAM_STALE_MS, subscribeToHyperliquidCandles } from './hyperliquid-ws';

class MockSocket {
    static OPEN = 1;
    static instances: MockSocket[] = [];
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    send = vi.fn();
    close = vi.fn(() => { this.readyState = 3; this.onclose?.(); });
    constructor() { MockSocket.instances.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    frame(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
}

const raw = { t: 0, T: 3_599_999, s: 'BTC', i: '1h', o: '100', h: '105', l: '95', c: '102', v: '10' };
let stop: (() => void) | undefined;
beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(3_600_000);
    MockSocket.instances = [];
    vi.stubGlobal('WebSocket', MockSocket);
});
afterEach(() => { stop?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Hyperliquid candle stream', () => {
    it('ignores malformed candles and frames for a different market', () => {
        const onCandle = vi.fn();
        const onStatus = vi.fn();
        stop = subscribeToHyperliquidCandles({ coin: 'BTC', interval: '1h', onCandle, onStatus });
        const socket = MockSocket.instances[0];
        socket.open();
        socket.frame({ channel: 'candle', data: [null, { ...raw, c: 'broken' }, { ...raw, s: 'ETH' }, { ...raw, h: '99' }, raw] });
        expect(onCandle).toHaveBeenCalledExactlyOnceWith({ time: 0, open: 100, high: 105, low: 95, close: 102, volume: 10 }, true);
        expect(onStatus).toHaveBeenLastCalledWith('LIVE');
    });
    it('does not label a subscription acknowledgment as verified live data', () => {
        const onStatus = vi.fn();
        stop = subscribeToHyperliquidCandles({ coin: 'BTC', interval: '1h', onCandle: vi.fn(), onStatus });
        MockSocket.instances[0].frame({ channel: 'subscriptionResponse' });
        expect(onStatus).not.toHaveBeenCalledWith('LIVE');
    });
    it('reconnects a silent socket even when no close event arrives', async () => {
        stop = subscribeToHyperliquidCandles({ coin: 'BTC', interval: '1h', onCandle: vi.fn(), onStatus: vi.fn() });
        const socket = MockSocket.instances[0];
        socket.open();
        await vi.advanceTimersByTimeAsync(STREAM_STALE_MS + 1_000);
        expect(socket.close).toHaveBeenCalledOnce();
        expect(MockSocket.instances).toHaveLength(2);
    });
    it('reconnects on error and ignores callbacks from a previous market after cleanup', async () => {
        const onCandle = vi.fn();
        stop = subscribeToHyperliquidCandles({ coin: 'BTC', interval: '1h', onCandle, onStatus: vi.fn() });
        const socket = MockSocket.instances[0];
        const previousMessage = socket.onmessage;
        socket.onerror?.();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(MockSocket.instances).toHaveLength(2);
        stop();
        previousMessage?.({ data: JSON.stringify({ channel: 'candle', data: raw }) });
        await vi.advanceTimersByTimeAsync(120_000);
        expect(onCandle).not.toHaveBeenCalled();
        expect(MockSocket.instances).toHaveLength(2);
    });
    it('reconnects a stalled subscription even while heartbeat replies continue', async () => {
        stop = subscribeToHyperliquidCandles({ coin: 'BTC', interval: '1h', onCandle: vi.fn(), onStatus: vi.fn() });
        const socket = MockSocket.instances[0];
        socket.open();
        for (let count = 0; count < 3; count += 1) {
            await vi.advanceTimersByTimeAsync(20_000);
            socket.frame({ channel: 'pong' });
        }
        await vi.advanceTimersByTimeAsync(STREAM_STALE_MS - 60_000 + 1_000);
        expect(socket.close).toHaveBeenCalledOnce();
        expect(MockSocket.instances).toHaveLength(2);
    });
});
