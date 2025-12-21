'use client';

import { useTradingStore, Timeframe } from '@/store/trading-store';

const timeframes: Timeframe[] = ['15m', '1h', '4h'];

export default function TimeframeToggle() {
    const { selectedTimeframe, setSelectedTimeframe } = useTradingStore();

    return (
        <div className="toggle-group">
            {timeframes.map((tf) => (
                <button
                    key={tf}
                    onClick={() => setSelectedTimeframe(tf)}
                    className={`toggle-btn ${selectedTimeframe === tf ? 'active' : ''}`}
                >
                    {tf}
                </button>
            ))}
        </div>
    );
}
