// RSI Calculation and Divergence Detection Module
// Implements RSI calculation and bullish/bearish divergence detection for signal confirmation

import { Candle, RsiDivergence } from './types';

/**
 * Calculate RSI (Relative Strength Index)
 * @param closes - Array of closing prices
 * @param period - RSI period (default 14)
 * @returns Array of RSI values (first `period` values will be NaN)
 */
export function calculateRSI(closes: number[], period: number = 14): number[] {
    const rsi: number[] = new Array(closes.length).fill(NaN);

    if (closes.length < period + 1) {
        return rsi;
    }

    // Calculate price changes
    const changes: number[] = [];
    for (let i = 1; i < closes.length; i++) {
        changes.push(closes[i] - closes[i - 1]);
    }

    // Separate gains and losses
    const gains = changes.map(c => (c > 0 ? c : 0));
    const losses = changes.map(c => (c < 0 ? Math.abs(c) : 0));

    // Calculate initial average gain/loss (simple average for first period)
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

    // Calculate first RSI value
    if (avgLoss === 0) {
        rsi[period] = 100;
    } else {
        const rs = avgGain / avgLoss;
        rsi[period] = 100 - (100 / (1 + rs));
    }

    // Calculate subsequent RSI values using smoothed moving average
    for (let i = period; i < changes.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

        if (avgLoss === 0) {
            rsi[i + 1] = 100;
        } else {
            const rs = avgGain / avgLoss;
            rsi[i + 1] = 100 - (100 / (1 + rs));
        }
    }

    return rsi;
}

/**
 * Find local highs in price data
 */
function findLocalHighs(
    values: number[],
    lookback: number = 5
): Array<{ index: number; value: number }> {
    const highs: Array<{ index: number; value: number }> = [];

    for (let i = lookback; i < values.length - lookback; i++) {
        let isHigh = true;
        for (let j = i - lookback; j <= i + lookback; j++) {
            if (j !== i && values[j] >= values[i]) {
                isHigh = false;
                break;
            }
        }
        if (isHigh && !isNaN(values[i])) {
            highs.push({ index: i, value: values[i] });
        }
    }

    return highs;
}

/**
 * Find local lows in price data
 */
function findLocalLows(
    values: number[],
    lookback: number = 5
): Array<{ index: number; value: number }> {
    const lows: Array<{ index: number; value: number }> = [];

    for (let i = lookback; i < values.length - lookback; i++) {
        let isLow = true;
        for (let j = i - lookback; j <= i + lookback; j++) {
            if (j !== i && values[j] <= values[i]) {
                isLow = false;
                break;
            }
        }
        if (isLow && !isNaN(values[i])) {
            lows.push({ index: i, value: values[i] });
        }
    }

    return lows;
}

/**
 * Detect Bullish Divergence
 * Price makes Lower Low (LL) while RSI makes Higher Low (HL)
 * Indicates potential bullish reversal
 */
export function detectBullishDivergence(
    candles: Candle[],
    rsi: number[],
    lookbackBars: number = 20
): RsiDivergence | null {
    const startIdx = Math.max(0, candles.length - lookbackBars);
    const prices = candles.slice(startIdx).map(c => c.low);
    const rsiSlice = rsi.slice(startIdx);

    const priceLows = findLocalLows(prices, 3);
    const rsiLows = findLocalLows(rsiSlice, 3);

    if (priceLows.length < 2 || rsiLows.length < 2) {
        return null;
    }

    // Compare recent lows
    const recentPriceLows = priceLows.slice(-2);
    const recentRsiLows = rsiLows.slice(-2);

    const priceLow1 = recentPriceLows[0];
    const priceLow2 = recentPriceLows[1];
    const rsiLow1 = recentRsiLows[0];
    const rsiLow2 = recentRsiLows[1];

    // Bullish divergence: Price LL, RSI HL
    if (priceLow2.value < priceLow1.value && rsiLow2.value > rsiLow1.value) {
        const strength = Math.min(100, Math.abs(rsiLow2.value - rsiLow1.value) * 2);

        return {
            type: 'BULLISH',
            pricePoint1: { index: priceLow1.index + startIdx, value: priceLow1.value },
            pricePoint2: { index: priceLow2.index + startIdx, value: priceLow2.value },
            rsiPoint1: { index: rsiLow1.index + startIdx, value: rsiLow1.value },
            rsiPoint2: { index: rsiLow2.index + startIdx, value: rsiLow2.value },
            strength,
        };
    }

    return null;
}

/**
 * Detect Bearish Divergence
 * Price makes Higher High (HH) while RSI makes Lower High (LH)
 * Indicates potential bearish reversal
 */
export function detectBearishDivergence(
    candles: Candle[],
    rsi: number[],
    lookbackBars: number = 20
): RsiDivergence | null {
    const startIdx = Math.max(0, candles.length - lookbackBars);
    const prices = candles.slice(startIdx).map(c => c.high);
    const rsiSlice = rsi.slice(startIdx);

    const priceHighs = findLocalHighs(prices, 3);
    const rsiHighs = findLocalHighs(rsiSlice, 3);

    if (priceHighs.length < 2 || rsiHighs.length < 2) {
        return null;
    }

    // Compare recent highs
    const recentPriceHighs = priceHighs.slice(-2);
    const recentRsiHighs = rsiHighs.slice(-2);

    const priceHigh1 = recentPriceHighs[0];
    const priceHigh2 = recentPriceHighs[1];
    const rsiHigh1 = recentRsiHighs[0];
    const rsiHigh2 = recentRsiHighs[1];

    // Bearish divergence: Price HH, RSI LH
    if (priceHigh2.value > priceHigh1.value && rsiHigh2.value < rsiHigh1.value) {
        const strength = Math.min(100, Math.abs(rsiHigh1.value - rsiHigh2.value) * 2);

        return {
            type: 'BEARISH',
            pricePoint1: { index: priceHigh1.index + startIdx, value: priceHigh1.value },
            pricePoint2: { index: priceHigh2.index + startIdx, value: priceHigh2.value },
            rsiPoint1: { index: rsiHigh1.index + startIdx, value: rsiHigh1.value },
            rsiPoint2: { index: rsiHigh2.index + startIdx, value: rsiHigh2.value },
            strength,
        };
    }

    return null;
}

/**
 * Check for any divergence (bullish or bearish)
 */
export function detectDivergence(
    candles: Candle[],
    rsiPeriod: number = 14,
    lookbackBars: number = 20
): RsiDivergence | null {
    const closes = candles.map(c => c.close);
    const rsi = calculateRSI(closes, rsiPeriod);

    // Check for bullish divergence first (typically more reliable at supports)
    const bullish = detectBullishDivergence(candles, rsi, lookbackBars);
    if (bullish) return bullish;

    // Check for bearish divergence
    const bearish = detectBearishDivergence(candles, rsi, lookbackBars);
    if (bearish) return bearish;

    return null;
}
