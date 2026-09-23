import { getTimeframeMs, type Candle, type Timeframe } from '../trading/types';
import { parseHyperliquidCandle } from './parse-candle';

const HYPERLIQUID_WS = 'wss://api.hyperliquid.xyz/ws';
export const STREAM_STALE_MS = 65_000;

export type MarketConnectionStatus = 'CONNECTING' | 'LIVE' | 'RECONNECTING' | 'ERROR';

interface SubscribeOptions {
    coin: string;
    interval: Timeframe;
    onCandle: (candle: Candle, isClosed: boolean) => void;
    onStatus: (status: MarketConnectionStatus) => void;
}

/** Subscribe with cancellation, heartbeat watchdog, and bounded reconnect backoff. */
export function subscribeToHyperliquidCandles({
    coin, interval, onCandle, onStatus,
}: SubscribeOptions): () => void {
    const subscription = { type: 'candle', coin, interval } as const;
    let socket: WebSocket | null = null;
    let stopped = false;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

    const clearConnectionTimers = () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (watchdogTimer) clearTimeout(watchdogTimer);
        heartbeatTimer = null;
        watchdogTimer = null;
    };

    const disconnect = () => {
        clearConnectionTimers();
        const previous = socket;
        socket = null;
        if (!previous) return;
        previous.onopen = null;
        previous.onmessage = null;
        previous.onerror = null;
        previous.onclose = null;
        previous.close();
    };

    const scheduleReconnect = () => {
        if (stopped || reconnectTimer) return;
        disconnect();
        onStatus('RECONNECTING');
        const delay = Math.min(30000, 1000 * (2 ** Math.min(reconnectAttempt, 5)));
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, delay);
    };

    const armWatchdog = () => {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        watchdogTimer = setTimeout(scheduleReconnect, STREAM_STALE_MS);
    };

    const connect = () => {
        if (stopped) return;
        onStatus(reconnectAttempt === 0 ? 'CONNECTING' : 'RECONNECTING');
        let connection: WebSocket;
        try {
            connection = new WebSocket(HYPERLIQUID_WS);
            socket = connection;
        } catch {
            onStatus('ERROR');
            scheduleReconnect();
            return;
        }
        const isCurrent = () => !stopped && socket === connection;
        armWatchdog();

        connection.onopen = () => {
            if (!isCurrent()) return;
            connection.send(JSON.stringify({ method: 'subscribe', subscription }));
            heartbeatTimer = setInterval(() => {
                if (isCurrent() && connection.readyState === WebSocket.OPEN) {
                    connection.send(JSON.stringify({ method: 'ping' }));
                }
            }, 30000);
        };

        connection.onmessage = (event) => {
            if (!isCurrent()) return;
            try {
                const message = JSON.parse(String(event.data)) as { channel?: string; data?: unknown };
                if (message.channel === 'error') {
                    onStatus('ERROR');
                    scheduleReconnect();
                    return;
                }
                if (message.channel === 'pong' || message.channel === 'subscriptionResponse') {
                    // An alive connection can still have a stalled subscription.
                    // Only verified candles reset the market-data watchdog.
                    return;
                }
                if (message.channel !== 'candle') return;
                const payload = Array.isArray(message.data) ? message.data : [message.data];
                const candles = payload.flatMap((item) => {
                    if (!item || item.s !== coin || item.i !== interval) return [];
                    const candle = parseHyperliquidCandle(item);
                    return candle ? [candle] : [];
                }).sort((first, second) => first.time - second.time);
                for (const candle of candles) {
                    onCandle(candle, candle.time + getTimeframeMs(interval) <= Date.now());
                }
                if (candles.length > 0) {
                    reconnectAttempt = 0;
                    armWatchdog();
                    onStatus('LIVE');
                }
            } catch {
                // Malformed frames cannot replace the last verified market data.
            }
        };
        connection.onerror = () => {
            if (!isCurrent()) return;
            onStatus('ERROR');
            scheduleReconnect();
        };
        connection.onclose = () => {
            if (isCurrent()) scheduleReconnect();
        };
    };

    connect();
    return () => {
        stopped = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ method: 'unsubscribe', subscription }));
        }
        disconnect();
    };
}
