'use client';

import { useTradingStore } from '@/store/trading-store';

export default function CoinSelector() {
    const { selectedCoin, setSelectedCoin, availableCoins, prices } = useTradingStore();

    return (
        <div className="relative">
            <select
                value={selectedCoin}
                onChange={(e) => setSelectedCoin(e.target.value)}
                className="select min-w-[140px] appearance-none pr-10"
            >
                {availableCoins.map((coin) => (
                    <option key={coin} value={coin}>
                        {coin}/USDT
                    </option>
                ))}
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </div>
        </div>
    );
}
