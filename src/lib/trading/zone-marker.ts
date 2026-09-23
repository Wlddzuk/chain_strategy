// Zone Marking Module
// Implements supply/demand zone detection per Chain Strategy Section 3

import {
    Candle,
    Zone,
    EngulfingPattern,
    getCandleDirection,
} from './types';

function buildZoneId(type: Zone['type'], candle: Candle): string {
    return `zone-${type.toLowerCase()}-${candle.time}`;
}

/**
 * Mark a Demand Zone (Buy Zone)
 * Reference: The last bearish candle before the rally
 * Proximal Line: Top of the body of the last bearish candle
 * Distal Line: Lowest wick point of that candle
 */
export function markDemandZone(
    candles: Candle[],
    referenceIndex: number,
    strength: number = 50
): Zone | null {
    // Find the last bearish candle before/at the reference index
    let bearishIndex = referenceIndex;

    // Walk back to find the last bearish candle if current isn't
    while (bearishIndex >= 0 && getCandleDirection(candles[bearishIndex]) !== 'BEARISH') {
        bearishIndex--;
    }

    if (bearishIndex < 0) return null;

    const referenceCandle = candles[bearishIndex];

    // Proximal (top) = top of body = max of open/close
    const proximalLine = Math.max(referenceCandle.open, referenceCandle.close);

    // Distal (bottom) = lowest wick point
    const distalLine = referenceCandle.low;

    return {
        id: buildZoneId('DEMAND', referenceCandle),
        type: 'DEMAND',
        proximalLine,
        distalLine,
        createdAt: referenceCandle.time,
        createdAtIndex: bearishIndex,
        status: 'ACTIVE',
        strength,
        originCandle: referenceCandle,
    };
}

/**
 * Mark a Supply Zone (Sell Zone)
 * Reference: The last bullish candle before the drop
 * Proximal Line: Bottom of the body of the last bullish candle
 * Distal Line: Highest wick point of that candle
 */
export function markSupplyZone(
    candles: Candle[],
    referenceIndex: number,
    strength: number = 50
): Zone | null {
    // Find the last bullish candle before/at the reference index
    let bullishIndex = referenceIndex;

    while (bullishIndex >= 0 && getCandleDirection(candles[bullishIndex]) !== 'BULLISH') {
        bullishIndex--;
    }

    if (bullishIndex < 0) return null;

    const referenceCandle = candles[bullishIndex];

    // Proximal (bottom) = bottom of body = min of open/close
    const proximalLine = Math.min(referenceCandle.open, referenceCandle.close);

    // Distal (top) = highest wick point
    const distalLine = referenceCandle.high;

    return {
        id: buildZoneId('SUPPLY', referenceCandle),
        type: 'SUPPLY',
        proximalLine,
        distalLine,
        createdAt: referenceCandle.time,
        createdAtIndex: bullishIndex,
        status: 'ACTIVE',
        strength,
        originCandle: referenceCandle,
    };
}

/**
 * Create zone from an engulfing pattern
 * Bullish engulfing → Demand zone from the engulfed (bearish) candle
 * Bearish engulfing → Supply zone from the engulfed (bullish) candle
 */
export function createZoneFromEngulfing(
    pattern: EngulfingPattern,
    strength: number = 70
): Zone {
    if (pattern.type === 'BULLISH') {
        // Demand zone from the bearish candle that got engulfed
        const refCandle = pattern.engulfedCandle;
        return {
            id: buildZoneId('DEMAND', refCandle),
            type: 'DEMAND',
            proximalLine: Math.max(refCandle.open, refCandle.close),
            // Use the lowest wick in the engulfing structure.
            distalLine: Math.min(refCandle.low, pattern.engulfingCandle.low),
            createdAt: refCandle.time,
            createdAtIndex: pattern.index - 1,
            status: 'ACTIVE',
            strength,
            originCandle: refCandle,
        };
    } else {
        // Supply zone from the bullish candle that got engulfed
        const refCandle = pattern.engulfedCandle;
        return {
            id: buildZoneId('SUPPLY', refCandle),
            type: 'SUPPLY',
            proximalLine: Math.min(refCandle.open, refCandle.close),
            // Use the highest wick in the engulfing structure.
            distalLine: Math.max(refCandle.high, pattern.engulfingCandle.high),
            createdAt: refCandle.time,
            createdAtIndex: pattern.index - 1,
            status: 'ACTIVE',
            strength,
            originCandle: refCandle,
        };
    }
}

/**
 * Check if a zone has been broken by a candle
 * A zone is broken when price closes beyond the distal line
 */
export function checkZoneBroken(zone: Zone, candle: Candle): boolean {
    if (zone.type === 'DEMAND') {
        // Demand zone broken if price closes below distal (bottom) line
        return candle.close < zone.distalLine;
    } else {
        // Supply zone broken if price closes above distal (top) line
        return candle.close > zone.distalLine;
    }
}

/**
 * Check if price is testing a zone (touching but not breaking)
 */
export function checkZoneTested(zone: Zone, candle: Candle): boolean {
    if (zone.type === 'DEMAND') {
        // Price wick touches zone but closes above proximal
        return candle.low <= zone.proximalLine && candle.close > zone.proximalLine;
    } else {
        // Price wick touches zone but closes below proximal
        return candle.high >= zone.proximalLine && candle.close < zone.proximalLine;
    }
}

/**
 * Find the next opposing zone for take profit target
 */
export function findNextOpposingZone(
    zones: Zone[],
    currentPrice: number,
    direction: 'LONG' | 'SHORT'
): Zone | null {
    const activeZones = zones.filter(z => z.status === 'ACTIVE');

    if (direction === 'LONG') {
        // Find nearest supply zone above current price
        const supplyZones = activeZones
            .filter(z => z.type === 'SUPPLY' && z.proximalLine > currentPrice)
            .sort((a, b) => a.proximalLine - b.proximalLine);
        return supplyZones[0] || null;
    } else {
        // Find nearest demand zone below current price
        const demandZones = activeZones
            .filter(z => z.type === 'DEMAND' && z.proximalLine < currentPrice)
            .sort((a, b) => b.proximalLine - a.proximalLine);
        return demandZones[0] || null;
    }
}

/**
 * Update zone status based on price action
 */
export function updateZoneStatus(zone: Zone, candles: Candle[]): Zone {
    // Only check candles after zone creation
    const relevantCandles = candles.filter((_, idx) => idx > zone.createdAtIndex);

    for (const candle of relevantCandles) {
        if (checkZoneBroken(zone, candle)) {
            return { ...zone, status: 'BROKEN' };
        }
        if (zone.status === 'ACTIVE' && checkZoneTested(zone, candle)) {
            return { ...zone, status: 'TESTED' };
        }
    }

    return zone;
}
