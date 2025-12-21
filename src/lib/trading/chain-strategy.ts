// Chain Strategy Engine
// Main strategy implementation following the 4-phase Chain logic from Section 4

import {
    Candle,
    Zone,
    ChainSignal,
    EngulfingPattern,
    generateId,
} from './types';
import {
    detectEngulfingPatterns,
    detectPinBars,
} from './pattern-detector';
import {
    createZoneFromEngulfing,
    markDemandZone,
    markSupplyZone,
    checkZoneBroken,
    findNextOpposingZone,
} from './zone-marker';
import {
    calculateRSI,
    detectBullishDivergence,
    detectBearishDivergence,
} from './rsi-divergence';
import { calculateRiskReward } from './risk-calculator';

export interface ChainStrategyState {
    zones: Zone[];
    events: Zone[];  // Broken zones marked as EVENTs
    signals: ChainSignal[];
}

export interface ScanResult {
    state: ChainStrategyState;
    newSignals: ChainSignal[];
}

/**
 * Main Chain Strategy Scanner
 * Implements the 4-phase logic:
 * Phase 1: Identify Engulfing structure and mark zone
 * Phase 2: Wait for zone break (mark as EVENT)
 * Phase 3: Identify origin of the breaking move
 * Phase 4: Generate entry signal at origin zone
 */
export function scanForSignals(
    candles: Candle[],
    coin: string,
    timeframe: '15m' | '1h' | '4h',
    existingState?: ChainStrategyState
): ScanResult {
    const state: ChainStrategyState = existingState || {
        zones: [],
        events: [],
        signals: [],
    };

    const newSignals: ChainSignal[] = [];

    // Phase 1: Identify Engulfing Structures and mark zones
    const engulfingPatterns = detectEngulfingPatterns(candles);
    const pinBars = detectPinBars(candles);

    // Create zones from engulfing patterns
    for (const pattern of engulfingPatterns) {
        // Skip if we already have a zone at this index
        const existingZone = state.zones.find(z => z.createdAtIndex === pattern.index - 1);
        if (existingZone) continue;

        const zone = createZoneFromEngulfing(pattern, 70);
        state.zones.push(zone);
    }

    // Boost zone strength if pin bar is present near zone
    for (const pinBar of pinBars) {
        const nearbyZone = state.zones.find(z =>
            Math.abs(z.createdAtIndex - pinBar.index) <= 2 &&
            z.status === 'ACTIVE'
        );
        if (nearbyZone) {
            nearbyZone.strength = Math.min(100, nearbyZone.strength + pinBar.wickRatio * 5);
        }
    }

    // Calculate RSI for divergence detection
    const closes = candles.map(c => c.close);
    const rsi = calculateRSI(closes, 14);

    // Phase 2 & 3: Check for zone breaks and identify origin moves
    const activeZones = [...state.zones].filter(z => z.status === 'ACTIVE');

    for (const zone of activeZones) {
        // Check each candle after zone creation
        for (let i = zone.createdAtIndex + 1; i < candles.length; i++) {
            const candle = candles[i];

            if (checkZoneBroken(zone, candle)) {
                // Mark zone as EVENT
                zone.status = 'EVENT';
                state.events.push(zone);

                // Phase 3: Find the origin of the breaking move
                const originZone = findOriginZone(candles, i, zone.type);

                if (originZone) {
                    // Check for RSI divergence to boost confidence
                    let confidence = originZone.strength;
                    let hasRsiDivergence = false;

                    if (zone.type === 'SUPPLY') {
                        // Supply broken by rally = look for bullish divergence
                        const bullishDiv = detectBullishDivergence(candles.slice(0, i + 1), rsi.slice(0, i + 1));
                        if (bullishDiv) {
                            confidence = Math.min(100, confidence + bullishDiv.strength * 0.3);
                            hasRsiDivergence = true;
                        }
                    } else {
                        // Demand broken by drop = look for bearish divergence
                        const bearishDiv = detectBearishDivergence(candles.slice(0, i + 1), rsi.slice(0, i + 1));
                        if (bearishDiv) {
                            confidence = Math.min(100, confidence + bearishDiv.strength * 0.3);
                            hasRsiDivergence = true;
                        }
                    }

                    // Phase 4: Generate entry signal
                    const direction: 'LONG' | 'SHORT' = zone.type === 'SUPPLY' ? 'LONG' : 'SHORT';
                    const entryPrice = originZone.proximalLine;
                    const stopLoss = direction === 'LONG'
                        ? originZone.distalLine * 0.999  // Slightly below distal
                        : originZone.distalLine * 1.001; // Slightly above distal

                    // Find take profit at next opposing zone
                    const opposingZone = findNextOpposingZone(state.zones, entryPrice, direction);
                    const takeProfit = opposingZone
                        ? opposingZone.proximalLine
                        : direction === 'LONG'
                            ? entryPrice * 1.02  // Default 2% TP
                            : entryPrice * 0.98;

                    const riskReward = calculateRiskReward(entryPrice, stopLoss, takeProfit);

                    // Only create signal if R:R is acceptable (at least 1.5)
                    if (riskReward >= 1.5) {
                        const signal: ChainSignal = {
                            id: generateId(),
                            coin,
                            timeframe,
                            phase: 'ENTRY',
                            direction,
                            eventZone: zone,
                            originZone,
                            entryPrice,
                            stopLoss,
                            takeProfit,
                            riskRewardRatio: riskReward,
                            confidence,
                            hasRsiDivergence,
                            createdAt: Date.now(),
                            status: 'PENDING',
                        };

                        state.signals.push(signal);
                        newSignals.push(signal);
                        state.zones.push(originZone);
                    }
                }

                break; // Zone is broken, move to next zone
            }
        }
    }

    // Remove broken zones from active list
    state.zones = state.zones.filter(z => z.status !== 'BROKEN');

    return { state, newSignals };
}

/**
 * Find the origin zone of the move that caused a break
 * For a supply break (upward), find the demand zone that originated the rally
 * For a demand break (downward), find the supply zone that originated the drop
 */
function findOriginZone(
    candles: Candle[],
    breakIndex: number,
    brokenZoneType: 'SUPPLY' | 'DEMAND'
): Zone | null {
    // Look back to find the start of the breaking move
    let moveStartIndex = breakIndex;

    if (brokenZoneType === 'SUPPLY') {
        // Supply was broken by a rally - find where the rally started
        // Walk back while candles are making higher lows
        for (let i = breakIndex - 1; i >= Math.max(0, breakIndex - 20); i--) {
            if (candles[i].low < candles[i + 1].low) {
                moveStartIndex = i + 1;
                break;
            }
            moveStartIndex = i;
        }
        // Create demand zone at origin of rally
        return markDemandZone(candles, moveStartIndex, 65);
    } else {
        // Demand was broken by a drop - find where the drop started
        // Walk back while candles are making lower highs
        for (let i = breakIndex - 1; i >= Math.max(0, breakIndex - 20); i--) {
            if (candles[i].high > candles[i + 1].high) {
                moveStartIndex = i + 1;
                break;
            }
            moveStartIndex = i;
        }
        // Create supply zone at origin of drop
        return markSupplyZone(candles, moveStartIndex, 65);
    }
}

/**
 * Check if an existing signal should be invalidated
 * Per Section 7: If price breaks through the Origin Zone, the setup is invalid
 */
export function checkSignalInvalidation(
    signal: ChainSignal,
    currentCandle: Candle
): boolean {
    return checkZoneBroken(signal.originZone, currentCandle);
}

/**
 * Update signal status
 */
export function updateSignalStatus(
    signal: ChainSignal,
    newStatus: ChainSignal['status']
): ChainSignal {
    return { ...signal, status: newStatus };
}
