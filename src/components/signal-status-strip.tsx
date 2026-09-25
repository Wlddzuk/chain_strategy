import type { ChainSignal } from '@/lib/trading/types';
import {
    getSignalStatusHeadline,
    type SignalStatusHeadlineTone,
} from '@/lib/ui/signal-display';

interface SignalStatusStripProps {
    signal: ChainSignal;
    currentPrice: number;
    approachThresholdPercent: number;
    now: number;
}

const TONE_CLASS: Record<SignalStatusHeadlineTone, string> = {
    waiting: 'border-sky-400/30 bg-sky-400/10 text-sky-100',
    ready: 'border-amber-400/50 bg-amber-400/15 text-amber-100',
    active: 'border-blue-400/45 bg-blue-400/15 text-blue-100',
    warning: 'border-amber-400/50 bg-amber-400/15 text-amber-100',
    success: 'border-[var(--long-green)]/45 bg-[var(--long-green-dim)] text-[var(--long-green)]',
    danger: 'border-[var(--short-red)]/55 bg-[var(--short-red-dim)] text-[var(--short-red)]',
    muted: 'border-[var(--card-border)] bg-[var(--background)] text-[var(--text-muted)]',
};

export default function SignalStatusStrip({
    signal,
    currentPrice,
    approachThresholdPercent,
    now,
}: SignalStatusStripProps) {
    const headline = getSignalStatusHeadline(signal, currentPrice, approachThresholdPercent, now);

    return (
        <div
            className={`mb-4 w-full rounded-lg border px-3 py-3 ${TONE_CLASS[headline.tone]}`}
            role="status"
            data-status-tone={headline.tone}
        >
            <p className="text-base font-extrabold leading-snug sm:text-lg">{headline.text}</p>
        </div>
    );
}
