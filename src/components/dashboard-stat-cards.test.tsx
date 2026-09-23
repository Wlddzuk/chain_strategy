import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ActiveSignalsCard from '@/components/active-signals-card';
import CurrentPriceCard from '@/components/current-price-card';
import TradingContextCard from '@/components/trading-context-card';

describe('dashboard stat hierarchy', () => {
    it('gives the selected market and price dominant context', () => {
        const markup = renderToStaticMarkup(
            <CurrentPriceCard className="price-grid-span" />
        );

        expect(markup).toContain('BTC / USD');
        expect(markup).toContain('>—<');
        expect(markup).toContain('>1h<');
        expect(markup).toContain('price-grid-span');
    });

    it('shows one all-markets active count and watchlist context', () => {
        const markup = renderToStaticMarkup(<ActiveSignalsCard />);

        expect(markup).toContain('Active signals');
        expect(markup).toContain('All markets');
        expect(markup).toContain('>0<');
        expect(markup).toContain('Watching 8');
        expect(markup).toContain('markets');
    });

    it('groups trading defaults and runtime health into a compact 2x2 card', () => {
        const markup = renderToStaticMarkup(
            <TradingContextCard
                className="context-grid-span"
                connectionStatus="LIVE"
                lastLiveUpdateRef={{ current: null }}
            />
        );

        expect(markup).toContain('Trading context');
        expect(markup).toContain('>1%<');
        expect(markup).toContain('>10x<');
        expect(markup).toContain('Connected - waiting tick');
        expect(markup).toContain('Watching');
        expect(markup).toContain('context-grid-span');
    });
});
