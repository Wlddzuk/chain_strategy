import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    getSizeDecimals,
    getCandleSnapshot,
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
