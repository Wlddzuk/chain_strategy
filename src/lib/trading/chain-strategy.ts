// Chain Strategy Engine
// Main strategy implementation following the 4-phase Chain logic from Section 4.

import {
    Candle,
    Zone,
    ChainSignal,
    RsiDivergence,
    Timeframe,
    getCandleDirection,
    getTimeframeMs,
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
    getZoneFreshness,
    isZoneTooOld,
    ZONE_MAX_AGE_MS,
} from './zone-marker';
import {
    calculateRSI,
    detectBullishDivergence,
    detectBearishDivergence,
} from './rsi-divergence';
import { calculateRiskReward } from './risk-calculator';

const DEFAULT_MIN_RISK_REWARD = 2;
const DEFAULT_MIN_STOP_DISTANCE_PERCENT = 0.4;
const DEFAULT_MAX_RISK_REWARD = 8;

export interface ChainStrategyState {
    zones: Zone[];
    events: Zone[];  // Broken zones marked as EVENTs
    signals: ChainSignal[];
}

export interface ScanOptions {
    higherTimeframe?: Timeframe;
    higherTimeframeCandles?: Candle[];
    minRiskReward?: number;
    minStopDistancePercent?: number;
    maxRiskRewardRatio?: number;
}

export interface ScanResult {
    state: ChainStrategyState;
    newSignals: ChainSignal[];
    invalidatedSignals: ChainSignal[];
}

export interface SetupQualityThresholds {
    minRiskReward: number;
    minStopDistancePercent: number;
    maxRiskRewardRatio: number;
}

interface RangeContext {
    lowerBound: number;
    upperBound: number;
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
    timeframe: Timeframe,
    existingState?: ChainStrategyState,
    options?: ScanOptions
): ScanResult {
    const state: ChainStrategyState = existingState || {
        zones: [],
        events: [],
        signals: [],
    };

    if (!candles.length) {
        return { state, newSignals: [], invalidatedSignals: [] };
    }

    // Snapshot windows roll. Array offsets are never identities; rebase retained
    // zones by timestamp and let persisted signals keep their own origin records.
    const indexesByTime = new Map(candles.map((candle, index) => [candle.time, index]));
    const rebaseZones = (zones: Zone[]) => zones.flatMap((zone) => {
        const index = indexesByTime.get(zone.createdAt);
        return index === undefined ? [] : [{ ...zone, createdAtIndex: index }];
    });
    state.zones = rebaseZones(state.zones);
    state.events = rebaseZones(state.events);

    const now = Date.now();
    const minRiskReward = options?.minRiskReward ?? DEFAULT_MIN_RISK_REWARD;
    const minStopDistancePercent = options?.minStopDistancePercent ?? DEFAULT_MIN_STOP_DISTANCE_PERCENT;
    const maxRiskRewardRatio = options?.maxRiskRewardRatio ?? DEFAULT_MAX_RISK_REWARD;
    const invalidatedSignals: ChainSignal[] = [];

    // Keep status up to date for existing pending signals.
    state.signals = state.signals.map((signal) => {
        if (signal.status !== 'PENDING' && signal.status !== 'APPROVED') {
            return signal;
        }

        const invalidatedAfterConfirmation = candles.some(
            (candle) => candle.time >= signal.createdAt && checkSignalInvalidation(signal, candle)
        );

        if (isSignalExpired(signal, now) || invalidatedAfterConfirmation) {
            const invalidatedSignal: ChainSignal = {
                ...signal,
                status: 'INVALIDATED',
                closedAt: now,
            };
            invalidatedSignals.push(invalidatedSignal);
            return invalidatedSignal;
        }

        return signal;
    });

    const existingAlivePending = state.signals.filter((signal) => signal.status === 'PENDING');

    // Phase 1: Identify Engulfing Structures and mark zones.
    const engulfingPatterns = detectEngulfingPatterns(candles);
    const pinBars = detectPinBars(candles);
    const newZones = new Set<Zone>();

    // Create zones from engulfing patterns.
    for (const pattern of engulfingPatterns) {
        const zoneType = pattern.type === 'BULLISH' ? 'DEMAND' : 'SUPPLY';
        const existingZone = state.zones.find(
            (zone) => zone.createdAt === pattern.engulfedCandle.time && zone.type === zoneType
        );

        if (existingZone) continue;

        const zone = createZoneFromEngulfing(pattern, 70);
        state.zones.push(zone);
        newZones.add(zone);
    }

    // Boost zone strength if pin bar is present near zone.
    for (const pinBar of pinBars) {
        const nearbyZone = state.zones.find((zone) =>
            newZones.has(zone) &&
            Math.abs(zone.createdAtIndex - pinBar.index) <= 2 &&
            zone.status === 'ACTIVE'
        );

        if (nearbyZone) {
            nearbyZone.strength = Math.min(100, nearbyZone.strength + pinBar.wickRatio * 5);
        }
    }

    // Calculate RSI for divergence detection.
    const closes = candles.map((candle) => candle.close);
    const rsi = calculateRSI(closes, 14);

    // Phase 2 & 3: Check for zone breaks and identify origin moves.
    const activeZones = state.zones.filter((zone) => zone.status === 'ACTIVE');
    const candidateSignals: ChainSignal[] = [];

    for (const zone of activeZones) {
        for (let index = zone.createdAtIndex + 1; index < candles.length; index++) {
            const candle = candles[index];

            if (!checkZoneBroken(zone, candle)) {
                continue;
            }

            zone.status = 'EVENT';
            if (!state.events.some((eventZone) => eventZone.id === zone.id)) {
                state.events.push(zone);
            }

            const originZone = findOriginZone(candles, index, zone.type);
            if (!originZone) {
                break;
            }

            // A historical origin that was subsequently closed through is no longer actionable.
            const originWasInvalidated = candles
                .slice(index + 1)
                .some((subsequentCandle) => checkZoneBroken(originZone, subsequentCandle));
            if (originWasInvalidated) {
                break;
            }

            const direction: 'LONG' | 'SHORT' = zone.type === 'SUPPLY' ? 'LONG' : 'SHORT';
            const higherTimeframeDuration = getTimeframeMs(options?.higherTimeframe ?? '1h');
            const rangeContext = buildRangeContext(
                options?.higherTimeframeCandles?.filter((bar) =>
                    bar.time + higherTimeframeDuration <= candle.time + getTimeframeMs(timeframe)
                ),
                candle.close
            );
            if (!passesRangeFilter(direction, originZone.proximalLine, rangeContext)) {
                break;
            }

            let confidence = originZone.strength;
            let hasRsiDivergence = false;
            let divergence: RsiDivergence | undefined;

            if (zone.type === 'SUPPLY') {
                const bullishDivergence = detectBullishDivergence(
                    candles.slice(0, index + 1),
                    rsi.slice(0, index + 1)
                );

                if (bullishDivergence) {
                    confidence = Math.min(100, confidence + bullishDivergence.strength * 0.3);
                    hasRsiDivergence = true;
                    divergence = bullishDivergence;
                }
            } else {
                const bearishDivergence = detectBearishDivergence(
                    candles.slice(0, index + 1),
                    rsi.slice(0, index + 1)
                );

                if (bearishDivergence) {
                    confidence = Math.min(100, confidence + bearishDivergence.strength * 0.3);
                    hasRsiDivergence = true;
                    divergence = bearishDivergence;
                }
            }

            const entryPrice = originZone.proximalLine;
            const stopLoss = direction === 'LONG'
                ? originZone.distalLine * 0.999
                : originZone.distalLine * 1.001;

            // A target must exist and remain unbroken at the trigger's close.
            // Pre-detecting the whole snapshot must not leak future zones into it.
            const targetZones = state.zones.filter((target) =>
                target.createdAtIndex + 1 <= index &&
                !candles.slice(target.createdAtIndex + 1, index + 1)
                    .some((bar) => checkZoneBroken(target, bar))
            ).map((target) => ({ ...target, status: 'ACTIVE' as const }));
            const opposingZone = findNextOpposingZone(targetZones, entryPrice, direction);
            // The Chain Strategy targets the next opposing zone. Do not fabricate a
            // percentage target when the chart has not supplied one.
            if (!opposingZone) {
                break;
            }
            const takeProfit = opposingZone.proximalLine;

            // Do not advertise old, already-used plans as fresh opportunities on
            // startup. OHLC history cannot prove an actual fill or outcome order.
            const alreadyReached = candles.slice(index + 1).some((bar) => direction === 'LONG'
                ? bar.low <= entryPrice || bar.high >= takeProfit
                : bar.high >= entryPrice || bar.low <= takeProfit);
            if (alreadyReached) break;

            const riskReward = calculateRiskReward(entryPrice, stopLoss, takeProfit);
            if (!passesSetupQualityGate(entryPrice, stopLoss, riskReward, {
                minRiskReward,
                minStopDistancePercent,
                maxRiskRewardRatio,
            })) {
                break;
            }

            // Strategy triggers only after the break candle CLOSES beyond distal.
            const signalCreatedAt = candle.time + getTimeframeMs(timeframe);
            // The origin zone is only worth trading while it is fresh: 3-4 days
            // on 5m/15m, up to a month on 1h/4h. After that it is history.
            const expiresAt = originZone.createdAt + ZONE_MAX_AGE_MS[timeframe];

            const signal: ChainSignal = {
                id: buildSignalId(coin, timeframe, direction, zone, originZone),
                coin,
                timeframe,
                phase: 'ENTRY',
                direction,
                eventZone: zone,
                originZone,
                entryPrice,
                stopLoss,
                takeProfit,
                partialTakeProfit: riskReward >= 3
                    ? {
                        price: direction === 'LONG'
                            ? entryPrice + (Math.abs(entryPrice - stopLoss) * 2)
                            : entryPrice - (Math.abs(entryPrice - stopLoss) * 2),
                        riskReward: 2,
                        closePercent: 50,
                    }
                    : undefined,
                riskRewardRatio: riskReward,
                confidence,
                hasRsiDivergence,
                divergence,
                higherTimeframe: options?.higherTimeframe,
                triggerCandleTime: candle.time,
                createdAt: signalCreatedAt,
                expiresAt,
                status: 'PENDING',
            };

            if (!state.zones.some((existingZone) => existingZone.id === originZone.id)) {
                state.zones.push(originZone);
            }

            candidateSignals.push(signal);
            break;
        }
    }

    const terminalSetupKeys = new Set(
        state.signals
            .filter((signal) => signal.status !== 'PENDING')
            .map(buildSignalSetupKey)
    );

    const allPendingCandidates = dedupeSignalsBySetup([
        ...existingAlivePending,
        ...candidateSignals,
    ]).filter(
        (signal) => !isSignalExpired(signal, now) && !terminalSetupKeys.has(buildSignalSetupKey(signal))
    );

    allPendingCandidates.sort((first, second) => second.createdAt - first.createdAt);
    const previousPendingKeys = new Set(existingAlivePending.map(buildSignalSetupKey));
    const newSignals = allPendingCandidates.filter(
        (signal) => !previousPendingKeys.has(buildSignalSetupKey(signal))
    );

    state.signals = [
        ...state.signals.filter((signal) => signal.status !== 'PENDING'),
        ...allPendingCandidates,
    ];

    // Keep zones clean.
    state.zones = dedupeZones(state.zones).filter((zone) => zone.status !== 'BROKEN');
    // Record how many times price has come back to each live zone; after the
    // second return a zone is spent.
    for (const zone of state.zones) {
        if (zone.status === 'ACTIVE') {
            zone.returns = getZoneFreshness(zone, candles, timeframe, now).returns;
        }
    }
    state.events = dedupeZones(state.events);

    return { state, newSignals, invalidatedSignals };
}

export function passesSetupQualityGate(
    entryPrice: number,
    stopLoss: number,
    riskRewardRatio: number,
    thresholds: SetupQualityThresholds
): boolean {
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) return false;
    if (!Number.isFinite(stopLoss) || stopLoss <= 0) return false;
    if (!Number.isFinite(riskRewardRatio)) return false;

    const stopDistancePercent = (Math.abs(entryPrice - stopLoss) / entryPrice) * 100;
    return stopDistancePercent >= thresholds.minStopDistancePercent &&
        riskRewardRatio >= thresholds.minRiskReward &&
        riskRewardRatio <= thresholds.maxRiskRewardRatio;
}

function dedupeZones(zones: Zone[]): Zone[] {
    const seen = new Map<string, Zone>();

    for (const zone of zones) {
        const key = `${zone.type}:${zone.createdAt}`;
        const existing = seen.get(key);
        if (!existing || zone.status === 'EVENT') {
            seen.set(key, zone);
        }
    }

    return Array.from(seen.values());
}

function dedupeSignalsBySetup(signals: ChainSignal[]): ChainSignal[] {
    const seen = new Map<string, ChainSignal>();

    for (const signal of signals) {
        const key = buildSignalSetupKey(signal);
        const existing = seen.get(key);

        if (!existing || signal.createdAt > existing.createdAt) {
            seen.set(key, signal);
        }
    }

    return Array.from(seen.values());
}

function buildSignalSetupKey(signal: ChainSignal): string {
    return [
        signal.coin,
        signal.timeframe,
        signal.direction,
        signal.eventZone.createdAt,
        signal.originZone.createdAt,
    ].join(':');
}

function buildSignalId(
    coin: string,
    timeframe: Timeframe,
    direction: 'LONG' | 'SHORT',
    eventZone: Zone,
    originZone: Zone
): string {
    return [
        'chain',
        coin,
        timeframe,
        direction.toLowerCase(),
        eventZone.createdAt,
        originZone.createdAt,
    ].join('-');
}

function isSignalExpired(signal: ChainSignal, now: number): boolean {
    // Plans saved before the age rule carry no expiry, so check the origin too.
    return now > signal.expiresAt || isZoneTooOld(signal.originZone, signal.timeframe, now);
}

function buildRangeContext(
    higherTimeframeCandles: Candle[] | undefined,
    currentPrice: number
): RangeContext | null {
    if (!higherTimeframeCandles || higherTimeframeCandles.length < 20) {
        return null;
    }

    const patterns = detectEngulfingPatterns(higherTimeframeCandles);
    if (!patterns.length) {
        return null;
    }

    const htfZones = patterns.map((pattern) => createZoneFromEngulfing(pattern, 70))
        .filter((zone) => !higherTimeframeCandles.slice(zone.createdAtIndex + 1)
            .some((bar) => checkZoneBroken(zone, bar)));
    const demandZones = htfZones
        .filter((zone) => zone.type === 'DEMAND' && zone.proximalLine <= currentPrice)
        .sort((a, b) => b.proximalLine - a.proximalLine);
    const supplyZones = htfZones
        .filter((zone) => zone.type === 'SUPPLY' && zone.proximalLine >= currentPrice)
        .sort((a, b) => a.proximalLine - b.proximalLine);

    const lowerDemand = demandZones[0];
    const upperSupply = supplyZones[0];

    if (!lowerDemand || !upperSupply || upperSupply.proximalLine <= lowerDemand.proximalLine) {
        return null;
    }

    return {
        lowerBound: lowerDemand.proximalLine,
        upperBound: upperSupply.proximalLine,
    };
}

function passesRangeFilter(
    direction: 'LONG' | 'SHORT',
    entryPrice: number,
    rangeContext: RangeContext | null
): boolean {
    if (!rangeContext) {
        return true;
    }

    const rangeSize = rangeContext.upperBound - rangeContext.lowerBound;
    if (rangeSize <= 0) {
        return true;
    }

    const positionInRange = (entryPrice - rangeContext.lowerBound) / rangeSize;

    if (direction === 'LONG') {
        return positionInRange <= 0.55;
    }

    return positionInRange >= 0.45;
}

/**
 * Find the origin zone of the move that caused a break.
 * For a supply break (upward), use the last bearish candle before the bullish break move.
 * For a demand break (downward), use the last bullish candle before the bearish break move.
 */
function findOriginZone(
    candles: Candle[],
    breakIndex: number,
    brokenZoneType: 'SUPPLY' | 'DEMAND'
): Zone | null {
    const breakDirection = brokenZoneType === 'SUPPLY' ? 'BULLISH' : 'BEARISH';
    const oppositeDirection = brokenZoneType === 'SUPPLY' ? 'BEARISH' : 'BULLISH';
    const lookbackStart = Math.max(0, breakIndex - 20);

    let impulseStartIndex = breakIndex;

    for (let index = breakIndex; index >= lookbackStart; index--) {
        const direction = getCandleDirection(candles[index]);

        if (direction === breakDirection || direction === 'DOJI') {
            impulseStartIndex = index;
            continue;
        }

        break;
    }

    let originIndex = -1;
    for (let index = impulseStartIndex - 1; index >= lookbackStart; index--) {
        if (getCandleDirection(candles[index]) === oppositeDirection) {
            originIndex = index;
            break;
        }
    }

    if (originIndex < 0) {
        return null;
    }

    if (brokenZoneType === 'SUPPLY') {
        return markDemandZone(candles, originIndex, 65);
    }

    return markSupplyZone(candles, originIndex, 65);
}

/**
 * Check if an existing signal should be invalidated.
 * Per Section 7: If price closes through the Origin Zone distal line, the setup is invalid.
 */
export function checkSignalInvalidation(
    signal: ChainSignal,
    currentCandle: Candle
): boolean {
    return checkZoneBroken(signal.originZone, currentCandle);
}

/**
 * Update signal status.
 */
export function updateSignalStatus(
    signal: ChainSignal,
    newStatus: ChainSignal['status']
): ChainSignal {
    return { ...signal, status: newStatus };
}
