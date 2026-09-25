'use client';

import { useEffect, useId, useRef, useState } from 'react';

export const GLOSSARY_ITEMS = [
    ['Zone', 'A price area where buyers or sellers acted strongly.'],
    ['Zone name vs direction', "A zone's name (supply/demand) is not the trade direction. The BREAK of a zone decides the direction."],
    ['Event', 'A broken zone that confirms the market moved with strength.'],
    ['Origin', 'The entry zone where the planned limit order waits.'],
    ['Entry', 'Also called the limit order: the price where the plan becomes a trade if price comes back.'],
    ['Stop', 'Also called stop loss: the price that closes the plan to limit a loss.'],
    ['Target', 'Also called take profit: the price that closes the plan in profit.'],
    ['R:R', 'Risk to reward: how much the plan may gain for each 1R risked.'],
    ['Missed', 'Price reached the target before it came back to entry, so the plan is too late.'],
    ['Invalidated', 'The setup failed before entry and must no longer be used.'],
    ['Would have won/lost', 'A price-only result for a plan the app did not place on an exchange.'],
] as const;

interface TradingGlossaryProps {
    className?: string;
}

export default function TradingGlossary({ className = '' }: TradingGlossaryProps) {
    const [isOpen, setIsOpen] = useState(false);
    const panelId = useId();
    const rootRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!isOpen) return;

        const handlePointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setIsOpen(false);
            buttonRef.current?.focus();
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    return (
        <div ref={rootRef} className={`relative inline-flex ${className}`}>
            <button
                ref={buttonRef}
                type="button"
                aria-label="Open trading glossary"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setIsOpen((open) => !open)}
                className="press inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--card-border)] text-sm font-bold text-[var(--text-muted)] transition-colors hover:bg-[var(--card-hover)] hover:text-white aria-expanded:border-[var(--accent)]/60 aria-expanded:text-[var(--accent)]"
                title="Plain-language trading glossary"
            >
                ?
            </button>

            {isOpen && (
                <section
                    id={panelId}
                    role="dialog"
                    aria-label="Trading glossary"
                    className="popover absolute right-0 top-full z-[95] mt-2 flex max-h-[min(26rem,calc(100dvh-12rem))] w-[min(22rem,calc(100vw-2rem))] flex-col text-left"
                >
                    <div className="flex items-center justify-between gap-3 border-b border-[var(--hairline)] px-4 py-3">
                        <h3 className="text-sm font-bold">Plain-language glossary</h3>
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            className="icon-btn icon-btn-sm"
                            aria-label="Close trading glossary"
                        >
                            ×
                        </button>
                    </div>
                    <dl className="space-y-2.5 overflow-y-auto overscroll-contain px-4 py-3 text-xs leading-relaxed">
                        {GLOSSARY_ITEMS.map(([term, definition]) => (
                            <div key={term}>
                                <dt className="font-semibold text-white">{term}</dt>
                                <dd className="text-[var(--text-muted)]">{definition}</dd>
                            </div>
                        ))}
                    </dl>
                </section>
            )}
        </div>
    );
}
