import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    getSizeDecimals,
    getCandleSnapshot,
    parseAssetContexts,
    parseSizeDecimals,
} from './hyperliquid-client';

describe('Hyperliquid size decimals', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('parses valid asset precision and ignores malformed universe rows', () => {
        expect(parseSizeDecimals({
            universe: [
                { name: 'BTC', szDecimals: 5, maxLeverage: 40 },
                { name: 'DOGE', szDecimals: 0, maxLeverage: 20 },
                { name: 'XRP', szDecimals: 1 },
                { name: 'BROKEN', szDecimals: -1, maxLeverage: 10 },
                { name: 123, szDecimals: 2, maxLeverage: 10 },
            ],
        })).toEqual({
            BTC: 5,
            DOGE: 0,
            XRP: 1,
        });
    });

    it('fetches meta with the supplied abort signal', async () => {
        const controller = new AbortController();
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                universe: [
                    { name: 'ETH', szDecimals: 4, maxLeverage: 25 },
                ],
            }),
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(getSizeDecimals(controller.signal)).resolves.toEqual({ ETH: 4 });
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.hyperliquid.xyz/info',
            expect.objectContaining({
                signal: expect.any(AbortSignal),
                body: JSON.stringify({ type: 'meta' }),
            })
        );
    });

    it('discards malformed candle rows, sorts and deduplicates valid history', async () => {
        const raw = { t: 1000, o: '100', h: '105', l: '95', c: '102', v: '10' };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => [null, {}, { ...raw, t: 3000, v: 'NaN' }, { ...raw, h: '99' }, { ...raw, t: 2000 }, raw, { ...raw, c: '103' }],
        }));
        await expect(getCandleSnapshot('BTC', '1h', 0, 3000)).resolves.toEqual([
            { time: 1000, open: 100, high: 105, low: 95, close: 103, volume: 10 },
            { time: 2000, open: 100, high: 105, low: 95, close: 102, volume: 10 },
        ]);
    });

    it('rejects an invalid metadata envelope so callers can keep their fallback', () => {
        expect(() => parseSizeDecimals({ universe: null })).toThrow(
            'Hyperliquid returned invalid exchange metadata'
        );
    });
});

describe('Hyperliquid asset contexts', () => {
    it('pairs each asset with its funding, open interest in dollars, and 24h volume', () => {
        expect(parseAssetContexts([
            { universe: [{ name: 'BTC' }, { name: 'ETH' }, { name: 'BAD' }] },
            [
                { funding: '0.0000125', openInterest: '1000', markPx: '80000', dayNtlVlm: '2500000000' },
                { funding: '-0.00002', openInterest: '5000', markPx: '2500', dayNtlVlm: '900000000' },
                { funding: 'oops', openInterest: '1', markPx: '1', dayNtlVlm: '1' },
            ],
        ])).toEqual({
            BTC: { fundingRatePercent: expect.closeTo(0.00125), openInterestUsd: 80_000_000, dayVolumeUsd: 2_500_000_000 },
            ETH: { fundingRatePercent: expect.closeTo(-0.002), openInterestUsd: 12_500_000, dayVolumeUsd: 900_000_000 },
        });
    });

    it('rejects a response that is not the meta-and-contexts pair', () => {
        expect(() => parseAssetContexts({ universe: [] })).toThrow('invalid asset contexts');
    });
});
