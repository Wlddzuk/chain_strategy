'use client';

import { useTradingStore, Timeframe } from '@/store/trading-store';

const timeframes: Timeframe[] = ['5m', '15m', '1h', '4h'];

export default function TimeframeToggle() {
    const selectedTimeframe = useTradingStore((state) => state.selectedTimeframe);
    const setSelectedTimeframe = useTradingStore((state) => state.setSelectedTimeframe);

    return (
        <div className="toggle-group" aria-label="Timeframe">
            {timeframes.map((tf) => (
                <button
                    key={tf}
                    type="button"
                    onClick={() => setSelectedTimeframe(tf)}
                    aria-pressed={selectedTimeframe === tf}
                    className={`toggle-btn ${selectedTimeframe === tf ? 'active' : ''}`}
                >
                    {tf}
                </button>
            ))}
        </div>
    );
}
