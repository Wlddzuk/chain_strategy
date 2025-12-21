// Binance WebSocket Client
// Provides real-time candle data streaming (no API key required for public streams)

import { Candle } from '../trading/types';

type KlineInterval = '15m' | '1h' | '4h';

interface BinanceKlineMessage {
    e: string;  // Event type
    E: number;  // Event time
    s: string;  // Symbol
    k: {
        t: number;  // Kline start time
        T: number;  // Kline close time
        s: string;  // Symbol
        i: string;  // Interval
        o: string;  // Open price
        c: string;  // Close price
        h: string;  // High price
        l: string;  // Low price
        v: string;  // Base asset volume
        n: number;  // Number of trades
        x: boolean; // Is kline closed
    };
}

export type CandleCallback = (candle: Candle, isClosed: boolean) => void;

interface Subscription {
    ws: WebSocket | null;
    symbol: string;
    interval: KlineInterval;
    callback: CandleCallback;
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    reconnectDelay: number;
}

class BinanceWebSocketClient {
    private subscriptions: Map<string, Subscription> = new Map();
    private baseUrl = 'wss://stream.binance.com:9443/ws';

    /**
     * Subscribe to real-time kline (candle) data
     * @param symbol - Trading pair (e.g., 'BTCUSDT', 'ETHUSDT', 'SOLUSDT')
     * @param interval - Candle interval ('15m', '1h', '4h')
     * @param callback - Function called on each candle update
     * @returns Subscription ID for unsubscribing
     */
    subscribe(
        symbol: string,
        interval: KlineInterval,
        callback: CandleCallback
    ): string {
        const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
        const subscriptionId = `${symbol}_${interval}`;

        // Don't create duplicate subscriptions
        if (this.subscriptions.has(subscriptionId)) {
            console.log(`Already subscribed to ${subscriptionId}`);
            return subscriptionId;
        }

        const subscription: Subscription = {
            ws: null,
            symbol: symbol.toUpperCase(),
            interval,
            callback,
            reconnectAttempts: 0,
            maxReconnectAttempts: 5,
            reconnectDelay: 1000,
        };

        this.subscriptions.set(subscriptionId, subscription);
        this.connect(subscriptionId, streamName);

        return subscriptionId;
    }

    private connect(subscriptionId: string, streamName: string): void {
        const subscription = this.subscriptions.get(subscriptionId);
        if (!subscription) return;

        const wsUrl = `${this.baseUrl}/${streamName}`;

        try {
            const ws = new WebSocket(wsUrl);
            subscription.ws = ws;

            ws.onopen = () => {
                console.log(`Connected to Binance stream: ${streamName}`);
                subscription.reconnectAttempts = 0;
            };

            ws.onmessage = (event) => {
                try {
                    const data: BinanceKlineMessage = JSON.parse(event.data);

                    if (data.e === 'kline') {
                        const kline = data.k;
                        const candle: Candle = {
                            time: kline.t,
                            open: parseFloat(kline.o),
                            high: parseFloat(kline.h),
                            low: parseFloat(kline.l),
                            close: parseFloat(kline.c),
                            volume: parseFloat(kline.v),
                        };

                        subscription.callback(candle, kline.x);
                    }
                } catch (error) {
                    console.error('Error parsing Binance message:', error);
                }
            };

            ws.onerror = (error) => {
                console.error(`WebSocket error for ${streamName}:`, error);
            };

            ws.onclose = () => {
                console.log(`WebSocket closed for ${streamName}`);
                this.handleReconnect(subscriptionId, streamName);
            };

        } catch (error) {
            console.error(`Failed to connect to ${streamName}:`, error);
            this.handleReconnect(subscriptionId, streamName);
        }
    }

    private handleReconnect(subscriptionId: string, streamName: string): void {
        const subscription = this.subscriptions.get(subscriptionId);
        if (!subscription) return;

        if (subscription.reconnectAttempts < subscription.maxReconnectAttempts) {
            subscription.reconnectAttempts++;
            const delay = subscription.reconnectDelay * subscription.reconnectAttempts;

            console.log(
                `Reconnecting to ${streamName} in ${delay}ms (attempt ${subscription.reconnectAttempts})`
            );

            setTimeout(() => {
                this.connect(subscriptionId, streamName);
            }, delay);
        } else {
            console.error(`Max reconnect attempts reached for ${streamName}`);
        }
    }

    /**
     * Unsubscribe from a stream
     */
    unsubscribe(subscriptionId: string): void {
        const subscription = this.subscriptions.get(subscriptionId);
        if (subscription?.ws) {
            subscription.ws.close();
        }
        this.subscriptions.delete(subscriptionId);
        console.log(`Unsubscribed from ${subscriptionId}`);
    }

    /**
     * Unsubscribe from all streams
     */
    unsubscribeAll(): void {
        for (const [id] of this.subscriptions) {
            this.unsubscribe(id);
        }
    }

    /**
     * Get list of active subscriptions
     */
    getActiveSubscriptions(): string[] {
        return Array.from(this.subscriptions.keys());
    }
}

// Export singleton instance
export const binanceWS = new BinanceWebSocketClient();

// Map Hyperliquid coin names to Binance symbols
export const coinToBinanceSymbol: Record<string, string> = {
    'BTC': 'BTCUSDT',
    'ETH': 'ETHUSDT',
    'SOL': 'SOLUSDT',
    'DOGE': 'DOGEUSDT',
    'XRP': 'XRPUSDT',
    'AVAX': 'AVAXUSDT',
    'LINK': 'LINKUSDT',
    'ARB': 'ARBUSDT',
    'OP': 'OPUSDT',
    'MATIC': 'MATICUSDT',
    'APT': 'APTUSDT',
    'SUI': 'SUIUSDT',
    'INJ': 'INJUSDT',
    'TIA': 'TIAUSDT',
    'SEI': 'SEIUSDT',
};

/**
 * Get Binance symbol from coin name
 */
export function getBinanceSymbol(coin: string): string {
    return coinToBinanceSymbol[coin.toUpperCase()] || `${coin.toUpperCase()}USDT`;
}
