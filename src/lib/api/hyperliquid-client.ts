// Hyperliquid API Client
// Handles read-only market and account data

import { Candle, Timeframe } from '../trading/types';

import { parseHyperliquidCandle } from './parse-candle';
import { requestInfo } from './request-info';

export interface AssetMeta {
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
    interval: Timeframe,
    startTime: number,
    endTime: number,
    signal?: AbortSignal
): Promise<Candle[]> {
    const data = await requestInfo<unknown>({
        type: 'candleSnapshot',
        req: { coin, interval, startTime, endTime },
    }, signal);
    if (!Array.isArray(data)) {
        throw new Error('Hyperliquid returned an invalid candle snapshot');
    }

    const uniqueCandles = new Map<number, Candle>();
    for (const rawCandle of data) {
        const candle = parseHyperliquidCandle(rawCandle);
        if (candle) uniqueCandles.set(candle.time, candle);
    }

    if (uniqueCandles.size === 0) throw new Error('Hyperliquid returned no verified candles');

    return Array.from(uniqueCandles.values()).sort((first, second) => first.time - second.time);
}

/**
 * Fetch current mid prices for all coins
 */
export async function getAllMids(signal?: AbortSignal): Promise<Record<string, number>> {
    const data = await requestInfo<Record<string, unknown>>({ type: 'allMids' }, signal);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Hyperliquid returned invalid mid prices');
    }

    const mids: Record<string, number> = {};
    for (const [coin, price] of Object.entries(data)) {
        const parsedPrice = typeof price === 'string' || typeof price === 'number' ? Number(price) : NaN;
        if (Number.isFinite(parsedPrice) && parsedPrice > 0) mids[coin] = parsedPrice;
    }

    return mids;
}

/**
 * Fetch exchange metadata (asset list, decimals, max leverage)
 */
async function fetchExchangeMeta(signal?: AbortSignal): Promise<unknown> {
    return requestInfo({ type: 'meta' }, signal);
}

function parseExchangeMeta(data: unknown): AssetMeta[] {
    if (
        typeof data !== 'object' ||
        data === null ||
        !('universe' in data) ||
        !Array.isArray(data.universe)
    ) {
        throw new Error('Hyperliquid returned invalid exchange metadata');
    }

    return data.universe.flatMap((asset): AssetMeta[] => {
        if (typeof asset !== 'object' || asset === null) return [];

        const name = 'name' in asset ? asset.name : undefined;
        const szDecimals = 'szDecimals' in asset ? asset.szDecimals : undefined;
        const maxLeverage = 'maxLeverage' in asset ? asset.maxLeverage : undefined;
        if (
            typeof name !== 'string' ||
            name.length === 0 ||
            typeof szDecimals !== 'number' ||
            !Number.isInteger(szDecimals) ||
            szDecimals < 0 ||
            typeof maxLeverage !== 'number' ||
            !Number.isFinite(maxLeverage)
        ) {
            return [];
        }

        return [{ name, szDecimals, maxLeverage }];
    });
}

export function parseSizeDecimals(data: unknown): Record<string, number> {
    if (
        typeof data !== 'object' ||
        data === null ||
        !('universe' in data) ||
        !Array.isArray(data.universe)
    ) {
        throw new Error('Hyperliquid returned invalid exchange metadata');
    }

    return Object.fromEntries(data.universe.flatMap((asset): Array<[string, number]> => {
        if (typeof asset !== 'object' || asset === null) return [];
        const name = 'name' in asset ? asset.name : undefined;
        const szDecimals = 'szDecimals' in asset ? asset.szDecimals : undefined;
        if (
            typeof name !== 'string' ||
            name.length === 0 ||
            typeof szDecimals !== 'number' ||
            !Number.isInteger(szDecimals) ||
            szDecimals < 0
        ) {
            return [];
        }
        return [[name, szDecimals]];
    }));
}

export async function getExchangeMeta(signal?: AbortSignal): Promise<AssetMeta[]> {
    return parseExchangeMeta(await fetchExchangeMeta(signal));
}

export async function getSizeDecimals(signal?: AbortSignal): Promise<Record<string, number>> {
    return parseSizeDecimals(await fetchExchangeMeta(signal));
}

/**
 * Fetch user account state (positions, margin, etc.)
 */
export async function getAccountState(address: string): Promise<AccountState> {
    return requestInfo({ type: 'clearinghouseState', user: address });
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
    const data = await requestInfo<{ levels: Array<Array<{ px: string; sz: string }>> }>({
        type: 'l2Book', coin, nSigFigs,
    });
    return {
        bids: data.levels[0].map(({ px, sz }) => [px, sz]),
        asks: data.levels[1].map(({ px, sz }) => [px, sz]),
    };
}
