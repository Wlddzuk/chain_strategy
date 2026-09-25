// Zone Marking Module
// Implements supply/demand zone detection per Chain Strategy Section 3

import {
    Candle,
    Zone,
    EngulfingPattern,
    Timeframe,
    getCandleDirection,
    getTimeframeMs,
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

/**
 * Newer structure wins. Among the live (ACTIVE or TESTED) zones of one type,
 * the most recent is the one price should respect next; every older zone of
 * that type is superseded. Superseded zones are kept — price can still reach
 * them — they just stop being the main zone. Supply and demand are ranked
 * separately.
 */
export function findSupersededZoneIds(zones: Zone[]): Set<string> {
    const superseded = new Set<string>();
    for (const type of ['DEMAND', 'SUPPLY'] as const) {
        const live = zones.filter((zone) => zone.type === type && (zone.status === 'ACTIVE' || zone.status === 'TESTED'));
        if (live.length < 2) continue;
        const newest = live.reduce((latest, zone) => (zone.createdAt > latest.createdAt ? zone : latest));
        for (const zone of live) if (zone.id !== newest.id) superseded.add(zone.id);
    }
    return superseded;
}

// ---------------------------------------------------------------------------
// Zone freshness (Muro Crypto, Supply & Demand Part I)
//
// The traders who built a zone defend it on the first return, maybe a second.
// After that it is spent. Zones also age out: 5m-15m zones are good for 3-4
// days, 1h-4h zones for up to a month.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export const ZONE_MAX_AGE_MS: Record<Timeframe, number> = {
    '5m': 4 * DAY_MS,
    '15m': 4 * DAY_MS,
    '1h': 30 * DAY_MS,
    '4h': 30 * DAY_MS,
};

/** Returns at or beyond this count mean the zone has been used up. */
const SPENT_AFTER_RETURNS = 2;

/** A first return within this many candles of price leaving is "straight back". */
const QUICK_RETURN_CANDLES = 2;

export interface ZoneFreshness {
    returns: number;
    /** Price is inside the zone right now on its first return. */
    firstReturnNow: boolean;
    /** The first return came straight back — weaker, a caution not a filter. */
    quickReturn: boolean;
    spent: boolean;
    tooOld: boolean;
}

function touchesZone(zone: Zone, candle: Candle): boolean {
    return zone.type === 'DEMAND'
        ? candle.low <= zone.proximalLine
        : candle.high >= zone.proximalLine;
}

export function isZoneTooOld(zone: Zone, timeframe: Timeframe, now: number): boolean {
    return now - zone.createdAt > ZONE_MAX_AGE_MS[timeframe];
}

/**
 * Count returns as visits: price has to leave the zone before coming back
 * counts. Price is still at the zone while it forms (the engulfing candle
 * overlaps the swallowed one), so that never counts as a return.
 */
export function getZoneFreshness(
    zone: Zone,
    candles: Candle[],
    timeframe: Timeframe,
    now: number
): ZoneFreshness {
    let returns = 0;
    let inZone = true;
    let candlesAway = 0;
    let quickReturn = false;

    for (const candle of candles) {
        if (candle.time <= zone.createdAt) continue;
        if (checkZoneBroken(zone, candle)) break;

        const touching = touchesZone(zone, candle);
        if (touching && !inZone) {
            returns++;
            if (returns === 1 && candlesAway <= QUICK_RETURN_CANDLES) quickReturn = true;
        }
        candlesAway = touching ? 0 : candlesAway + 1;
        inZone = touching;
    }

    return {
        returns,
        firstReturnNow: returns === 1 && inZone,
        quickReturn,
        spent: returns >= SPENT_AFTER_RETURNS,
        tooOld: isZoneTooOld(zone, timeframe, now),
    };
}

/** A live zone still worth trading from: not spent, not past its age. */
export function isZoneTradeable(zone: Zone, timeframe: Timeframe, now: number): boolean {
    return zone.status === 'ACTIVE' &&
        (zone.returns ?? 0) < SPENT_AFTER_RETURNS &&
        !isZoneTooOld(zone, timeframe, now);
}

/** Same-side zones formed within this many candles of each other can stack. */
const STACK_CANDLES = 6;

/** Stacked boxes may sit this far apart (fraction of price) and still merge. */
const STACK_GAP_FRACTION = 0.005;

/**
 * Several supply (or demand) zones built one after another, overlapping or
 * edge to edge, are drawn as one zone covering all of them. Display only.
 * The merged box starts at its oldest member and ranks by its newest.
 */
export function mergeStackedZones(zones: Zone[], timeframe: Timeframe): Zone[] {
    const stackWindow = STACK_CANDLES * getTimeframeMs(timeframe);
    const bounds = (zone: Zone) => [
        Math.min(zone.proximalLine, zone.distalLine),
        Math.max(zone.proximalLine, zone.distalLine),
    ];
    const merged: Zone[] = [];

    for (const type of ['DEMAND', 'SUPPLY'] as const) {
        const sameSide = zones
            .filter((zone) => zone.type === type && zone.status !== 'EVENT' && zone.status !== 'BROKEN')
            .sort((first, second) => first.createdAt - second.createdAt);
        let group: Zone[] = [];

        const flush = () => {
            if (group.length === 1) merged.push(group[0]);
            if (group.length > 1) {
                const newest = group[group.length - 1];
                const lows = group.map((zone) => bounds(zone)[0]);
                const highs = group.map((zone) => bounds(zone)[1]);
                merged.push({
                    ...newest,
                    id: `stack-${group.map((zone) => zone.id).join('+')}`,
                    proximalLine: type === 'DEMAND' ? Math.max(...highs) : Math.min(...lows),
                    distalLine: type === 'DEMAND' ? Math.min(...lows) : Math.max(...highs),
                    createdAt: group[0].createdAt,
                    strength: Math.max(...group.map((zone) => zone.strength)),
                    returns: Math.max(...group.map((zone) => zone.returns ?? 0)),
                    stackedCount: group.length,
                });
            }
            group = [];
        };

        for (const zone of sameSide) {
            const previous = group[group.length - 1];
            if (previous) {
                const [low, high] = bounds(zone);
                const [previousLow, previousHigh] = bounds(previous);
                const gap = Math.max(low, previousLow) - Math.min(high, previousHigh);
                const close = zone.createdAt - previous.createdAt <= stackWindow &&
                    gap <= STACK_GAP_FRACTION * zone.proximalLine;
                if (!close) flush();
            }
            group.push(zone);
        }
        flush();
    }

    return [...merged, ...zones.filter((zone) => zone.status === 'EVENT' || zone.status === 'BROKEN')];
}
