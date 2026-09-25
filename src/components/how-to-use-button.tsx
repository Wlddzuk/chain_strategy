'use client';

import { BookOpen } from 'lucide-react';

interface HowToUseButtonProps {
    onClick: () => void;
    showNudge?: boolean;
}

export function HowToUseButton({
    onClick,
    showNudge = false,
}: HowToUseButtonProps) {
    return (
        <button
            type="button"
            aria-label="How to use Chain Trader"
            title="How to use Chain Trader"
            onClick={onClick}
            className="btn btn-outline relative px-3 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card-bg)]"
        >
            <BookOpen aria-hidden="true" size={18} strokeWidth={2} />
            {showNudge && (
                <span
                    aria-hidden="true"
                    className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400 ring-2 ring-[var(--card-bg)]"
                />
            )}
        </button>
    );
}
