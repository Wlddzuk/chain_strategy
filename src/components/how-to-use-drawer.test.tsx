import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HowToUseButton } from './how-to-use-button';
import { HowToUseDrawer } from './how-to-use-drawer';

function normalizeWhitespace(value: string): string {
    return value
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.:;!?])/g, '$1')
        .trim();
}

function markdownToVisibleText(markdown: string): string {
    return normalizeWhitespace(markdown
        .split('\n')
        .filter((line) => !/^\|(?:\s*:?-+:?\s*\|)+$/.test(line.trim()))
        .map((line) => line
            .replace(/^#{1,6}\s+/, '')
            .replace(/^-\s+/, '')
            .replace(/^\d+\.\s+/, '')
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((part) => part.trim())
            .join(' ')
            .replace(/\*/g, '')
        )
        .join(' '));
}

function markupToVisibleText(markup: string): string {
    return normalizeWhitespace(markup
        .replace(/<[^>]*>/g, ' ')
        .replaceAll('&quot;', '"')
        .replaceAll('&#x27;', "'")
        .replaceAll('&apos;', "'")
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>'));
}

describe('HowToUseDrawer', () => {
    it('renders nothing while closed', () => {
        expect(renderToStaticMarkup(
            <HowToUseDrawer open={false} onClose={() => undefined} />
        )).toBe('');
    });

    it('renders the repository guide verbatim with semantic table and lists', () => {
        const guidePath = fileURLToPath(new URL('../../HOW-TO-USE.md', import.meta.url));
        const markdownText = markdownToVisibleText(readFileSync(guidePath, 'utf8'));
        const markup = renderToStaticMarkup(
            <HowToUseDrawer open onClose={() => undefined} />
        );
        // The section jump bar is navigation chrome, not guide text.
        const guideMarkup = markup.replace(/<nav[\s\S]*?<\/nav>/, '');

        expect(markupToVisibleText(guideMarkup)).toBe(markdownText);
        expect(markup).toContain('role="dialog"');
        expect(markup).toContain('aria-modal="true"');
        expect(markup.match(/<table/g)).toHaveLength(1);
        expect(markup.match(/<th(?:\s|>)/g)).toHaveLength(9);
        expect(markup.match(/<ul/g)).toHaveLength(4);
        expect(markup.match(/<ol/g)).toHaveLength(2);
    });
});

describe('HowToUseButton', () => {
    it('renders the first-visit nudge only when requested', () => {
        const withoutNudge = renderToStaticMarkup(
            <HowToUseButton onClick={() => undefined} />
        );
        const withNudge = renderToStaticMarkup(
            <HowToUseButton onClick={() => undefined} showNudge />
        );

        expect(withoutNudge).not.toContain('animate-pulse');
        expect(withNudge).toContain('animate-pulse');
        expect(withNudge).toContain('aria-label="How to use Chain Trader"');
    });
});
