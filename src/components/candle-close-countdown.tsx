'use client';

import { useEffect, useState } from 'react';
import type { Timeframe } from '@/lib/trading/types';
import {
    formatCandleCountdown,
    getMillisecondsUntilCandleClose,
} from '@/lib/ui/candle-countdown';

interface CandleCloseCountdownProps {
    timeframe: Timeframe;
    className?: string;
}

export function CandleCloseCountdown({
    timeframe,
    className = '',
}: CandleCloseCountdownProps) {
    const [countdown, setCountdown] = useState<string | null>(null);

    useEffect(() => {
        let timeoutId: number | null = null;

        const updateCountdown = () => {
            const now = Date.now();
            setCountdown(formatCandleCountdown(
                getMillisecondsUntilCandleClose(now, timeframe)
            ));

            const nextSecondDelay = 1000 - (now % 1000);
            timeoutId = window.setTimeout(updateCountdown, nextSecondDelay);
        };

        timeoutId = window.setTimeout(updateCountdown, 0);
        return () => {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
        };
    }, [timeframe]);

    return (
        <span
            className={`whitespace-nowrap text-xs text-[var(--text-muted)] ${className}`}
            title="Signals confirm only when the candle closes."
        >
            closes in <span className="font-mono tabular-nums text-[var(--foreground)]">{countdown ?? '--:--'}</span>
        </span>
    );
}
