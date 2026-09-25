import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import SignalCard from '@/components/signal-card';
import TradeTicket from '@/components/trade-ticket';
import type { ChainSignal } from '@/lib/trading/types';
import { useTradingStore } from '@/store/trading-store';

const NOW = Date.UTC(2026, 6, 16, 12, 0, 0);
const DEFAULT_SETTINGS = useTradingStore.getState().settings;

const signal = {
    id: 'btc-1h-long',
    coin: 'BTC',
    timeframe: '1h',
    phase: 'ENTRY',
    direction: 'LONG',
    eventZone: {},
    originZone: {},
    entryPrice: 100,
    stopLoss: 98,
    takeProfit: 106,
    riskRewardRatio: 3,
    confidence: 80,
    hasRsiDivergence: false,
    createdAt: NOW - 30_000,
    expiresAt: NOW + 3_600_000,
    status: 'PENDING',
} as ChainSignal;

afterEach(() => {
    useTradingStore.setState({
        prices: {},
        selectedSignalId: null,
        plottedSignal: null,
        settings: DEFAULT_SETTINGS,
    });
});

describe('SignalCard entry distance', () => {
    it('renders the same percentage number in the strip, body, and To entry stat', () => {
        useTradingStore.setState({ prices: { BTC: 105 } });

        const markup = renderToStaticMarkup(
            <SignalCard signal={signal} now={NOW} />
        );
        const percentages = Array.from(
            markup.matchAll(/[+−-]?(\d+\.\d+)%/g),
            (match) => match[1]
        );

        expect(percentages).toEqual(['4.76', '4.76', '4.76']);
    });

    it('removes the NEW badge once a pending signal is 60 minutes old', () => {
        const markup = renderToStaticMarkup(
            <SignalCard
                signal={{ ...signal, createdAt: NOW - 2 * 60 * 60 * 1000 }}
                now={NOW}
            />
        );

        expect(markup).not.toContain('>NEW<');
    });

    it('uses only Entry, Stop, and Target level labels on the card and ticket', () => {
        const markup = renderToStaticMarkup(
            <>
                <SignalCard signal={signal} now={NOW} />
                <TradeTicket signal={signal} now={NOW} />
            </>
        );

        expect(markup).toContain('>Entry<');
        expect(markup).toContain('>Stop<');
        expect(markup).toContain('>Target<');
        expect(markup).not.toMatch(/Stop Loss|Take Profit|Take-profit|Partial TP/i);
    });

    it('presents Open Plan and Plot on chart as the two primary card actions', () => {
        const markup = renderToStaticMarkup(
            <SignalCard signal={signal} now={NOW} />
        );

        expect(markup).toContain('>Open Plan<');
        expect(markup).toContain('>Plot on chart<');
        expect(markup).not.toContain('>Plot Setup<');
    });

    it('keeps the price levels prominent and moves sizing into a collapsed native disclosure', () => {
        const markup = renderToStaticMarkup(
            <SignalCard signal={signal} now={NOW} />
        );

        expect(markup).toMatch(/<dl[^>]+aria-label="Planned price levels"/);
        expect(markup).toContain('>Entry<');
        expect(markup).toContain('>Stop<');
        expect(markup).toContain('>Target<');
        expect(markup).toContain('<details class=');
        expect(markup).not.toContain('<details open');
        expect(markup).toContain('<summary');
        expect(markup).toContain('Position sizing &amp; quantity');
        expect(markup).toContain('Position notional');
        expect(markup).toContain('Risk amount');
        expect(markup).toContain('Margin to allocate');
        expect(markup).toContain('BTC quantity');
    });

    it('keeps safety and partial-target instructions visible before collapsed sizing', () => {
        const markup = renderToStaticMarkup(
            <SignalCard
                signal={{
                    ...signal,
                    stopLoss: 99.99,
                    partialTakeProfit: {
                        price: 104,
                        riskReward: 2,
                        closePercent: 50,
                    },
                }}
                now={NOW}
            />
        );
        const disclosureIndex = markup.indexOf('<details');

        expect(markup).toContain('Partial Target');
        expect(markup).toContain('50% at $104.00');
        expect(markup).toContain('Position exceeds safe sizing for this account');
        expect(markup.indexOf('Partial Target')).toBeLessThan(disclosureIndex);
        expect(markup.indexOf('Position exceeds safe sizing for this account')).toBeLessThan(disclosureIndex);
    });

    it('does not repeat the do-not-chase warning for an entry-hit signal', () => {
        useTradingStore.setState({ prices: { BTC: 101 } });

        const markup = renderToStaticMarkup(
            <SignalCard
                signal={{
                    ...signal,
                    status: 'TOUCHED',
                    touchedAt: NOW - 5 * 60 * 1000,
                }}
                now={NOW}
            />
        );

        expect(markup.match(/do not chase/gi)).toHaveLength(1);
    });
});
