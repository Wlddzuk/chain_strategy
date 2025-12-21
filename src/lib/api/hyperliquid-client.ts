// Hyperliquid API Client
// Handles market data fetching and order placement

import { Candle } from '../trading/types';

const HYPERLIQUID_API = 'https://api.hyperliquid.xyz';

type Interval = '15m' | '1h' | '4h';

interface HyperliquidCandle {
    t: number;  // Open time
    T: number;  // Close time
    s: string;  // Symbol
    i: string;  // Interval
    o: string;  // Open
    c: string;  // Close
    h: string;  // High
    l: string;  // Low
    v: string;  // Volume
    n: number;  // Number of trades
}

interface AssetMeta {
    name: string;
    szDecimals: number;
    maxLeverage: number;
}

interface AccountState {
    marginSummary: {
        accountValue: string;
        totalMarginUsed: string;
        totalNtlPos: string;
        totalRawUsd: string;
    };
    assetPositions: Array<{
        position: {
            coin: string;
            entryPx: string;
            leverage: { type: string; value: number };
            liquidationPx: string;
            marginUsed: string;
            positionValue: string;
            returnOnEquity: string;
            szi: string;
            unrealizedPnl: string;
        };
    }>;
}

/**
 * Fetch historical candles from Hyperliquid
 */
export async function getCandleSnapshot(
    coin: string,
    interval: Interval,
    startTime: number,
    endTime: number
): Promise<Candle[]> {
    const response = await fetch(`${HYPERLIQUID_API}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: 'candleSnapshot',
            req: {
                coin,
                interval,
                startTime,
                endTime,
            },
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch candles: ${response.statusText}`);
    }

    const data: HyperliquidCandle[] = await response.json();

    return data.map((c) => ({
        time: c.t,
        open: parseFloat(c.o),
        high: parseFloat(c.h),
        low: parseFloat(c.l),
        close: parseFloat(c.c),
        volume: parseFloat(c.v),
    }));
}

/**
 * Fetch current mid prices for all coins
 */
export async function getAllMids(): Promise<Record<string, number>> {
    const response = await fetch(`${HYPERLIQUID_API}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'allMids' }),
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch mids: ${response.statusText}`);
    }

    const data: Record<string, string> = await response.json();

    const mids: Record<string, number> = {};
    for (const [coin, price] of Object.entries(data)) {
        mids[coin] = parseFloat(price);
    }

    return mids;
}

/**
 * Fetch exchange metadata (asset list, decimals, max leverage)
 */
export async function getExchangeMeta(): Promise<AssetMeta[]> {
    const response = await fetch(`${HYPERLIQUID_API}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'meta' }),
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch meta: ${response.statusText}`);
    }

    const data = await response.json();
    return data.universe as AssetMeta[];
}

/**
 * Fetch user account state (positions, margin, etc.)
 */
export async function getAccountState(address: string): Promise<AccountState> {
    const response = await fetch(`${HYPERLIQUID_API}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: 'clearinghouseState',
            user: address,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch account state: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Get user's equity from account state
 */
export async function getEquity(address: string): Promise<number> {
    const state = await getAccountState(address);
    return parseFloat(state.marginSummary.accountValue);
}

/**
 * Fetch L2 order book snapshot
 */
export async function getOrderBook(
    coin: string,
    nSigFigs: number = 4
): Promise<{ bids: [string, string][]; asks: [string, string][] }> {
    const response = await fetch(`${HYPERLIQUID_API}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: 'l2Book',
            coin,
            nSigFigs,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch order book: ${response.statusText}`);
    }

    const data = await response.json();
    return {
        bids: data.levels[0],
        asks: data.levels[1],
    };
}

// ============================================================================
// ORDER PLACEMENT (requires signing with private key)
// ============================================================================

import { ethers } from 'ethers';

interface OrderRequest {
    coin: string;
    isBuy: boolean;
    sz: number;
    limitPx: number;
    reduceOnly: boolean;
    orderType: { limit: { tif: 'Gtc' | 'Alo' | 'Ioc' } } | { trigger: { triggerPx: number; isMarket: boolean; tpsl: 'tp' | 'sl' } };
}

/**
 * Sign and place an order on Hyperliquid
 * This requires the user's private key
 */
export async function placeOrder(
    order: OrderRequest,
    privateKey: string,
    vaultAddress?: string
): Promise<{ status: string; response: unknown }> {
    const wallet = new ethers.Wallet(privateKey);

    const timestamp = Date.now();
    const nonce = timestamp;

    // Build the action
    const action = {
        type: 'order',
        orders: [{
            a: getAssetIndex(order.coin), // Asset index
            b: order.isBuy,
            p: order.limitPx.toString(),
            s: order.sz.toString(),
            r: order.reduceOnly,
            t: order.orderType,
        }],
        grouping: 'na',
    };

    // Sign the action
    const domain = {
        name: 'Exchange',
        version: '1',
        chainId: 42161, // Arbitrum
        verifyingContract: '0x0000000000000000000000000000000000000000',
    };

    const types = {
        Agent: [
            { name: 'source', type: 'string' },
            { name: 'connectionId', type: 'bytes32' },
        ],
    };

    // Create phantom agent for signing
    const connectionId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'uint256'],
            [wallet.address, nonce]
        )
    );

    const signature = await wallet.signTypedData(domain, types, {
        source: 'a',
        connectionId,
    });

    // Send to exchange
    const response = await fetch(`${HYPERLIQUID_API}/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action,
            nonce,
            signature,
            vaultAddress: vaultAddress || null,
        }),
    });

    const result = await response.json();

    return {
        status: response.ok ? 'success' : 'error',
        response: result,
    };
}

/**
 * Cancel an order by order ID
 */
export async function cancelOrder(
    coin: string,
    orderId: number,
    privateKey: string
): Promise<{ status: string; response: unknown }> {
    const wallet = new ethers.Wallet(privateKey);

    const timestamp = Date.now();
    const nonce = timestamp;

    const action = {
        type: 'cancel',
        cancels: [{
            a: getAssetIndex(coin),
            o: orderId,
        }],
    };

    // Simplified signing (full implementation would use proper EIP-712)
    const message = JSON.stringify({ action, nonce });
    const signature = await wallet.signMessage(message);

    const response = await fetch(`${HYPERLIQUID_API}/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action,
            nonce,
            signature,
        }),
    });

    const result = await response.json();

    return {
        status: response.ok ? 'success' : 'error',
        response: result,
    };
}

// Asset name to index mapping (you'd typically fetch this from meta)
const assetIndexes: Record<string, number> = {
    'BTC': 0,
    'ETH': 1,
    'SOL': 4,
    // Add more as needed
};

function getAssetIndex(coin: string): number {
    return assetIndexes[coin.toUpperCase()] ?? 0;
}

/**
 * Create a limit order for the Chain Strategy
 */
export function createLimitOrder(
    coin: string,
    direction: 'LONG' | 'SHORT',
    size: number,
    limitPrice: number
): OrderRequest {
    return {
        coin,
        isBuy: direction === 'LONG',
        sz: size,
        limitPx: limitPrice,
        reduceOnly: false,
        orderType: { limit: { tif: 'Gtc' } }, // Good till cancelled
    };
}

/**
 * Create a stop loss order
 */
export function createStopLossOrder(
    coin: string,
    direction: 'LONG' | 'SHORT',
    size: number,
    triggerPrice: number
): OrderRequest {
    return {
        coin,
        isBuy: direction === 'SHORT', // Opposite of position
        sz: size,
        limitPx: triggerPrice,
        reduceOnly: true,
        orderType: { trigger: { triggerPx: triggerPrice, isMarket: true, tpsl: 'sl' } },
    };
}

/**
 * Create a take profit order
 */
export function createTakeProfitOrder(
    coin: string,
    direction: 'LONG' | 'SHORT',
    size: number,
    triggerPrice: number
): OrderRequest {
    return {
        coin,
        isBuy: direction === 'SHORT', // Opposite of position
        sz: size,
        limitPx: triggerPrice,
        reduceOnly: true,
        orderType: { trigger: { triggerPx: triggerPrice, isMarket: false, tpsl: 'tp' } },
    };
}
