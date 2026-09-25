import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DashboardHeader } from '@/components/dashboard-header';

describe('DashboardHeader', () => {
    it('uses the distinctive chain lockup while preserving dashboard controls', () => {
        const markup = renderToStaticMarkup(
            <DashboardHeader
                settingsOpen={false}
                onSettingsToggle={() => undefined}
            />
        );

        expect(markup).toContain('>CHAIN<');
        expect(markup).toContain('>TRADER<');
        expect(markup).toContain('Plan the retrace. Never chase.');
        expect(markup).toContain('aria-label="Settings"');
        expect(markup).toContain('aria-label="How to use Chain Trader"');
        expect(markup).not.toContain('bg-gradient-to-r');
    });
});
