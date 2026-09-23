import { describe, expect, it } from 'vitest';
import { passesSetupQualityGate, scanForSignals } from './chain-strategy';
import { Candle } from './types';

const HOUR = 60 * 60 * 1000;
const START = Date.UTC(2026, 2, 1, 8, 0, 0);

function candle(index: number, open: number, high: number, low: number, close: number): Candle {
    return {
        time: START + (index * HOUR),
        open,
        high,
        low,
        close,
        volume: 1000,
    };
}

function validLongSetup(): Candle[] {
    return [
        // Higher active supply zone used as the strategy-defined target.
        candle(0, 105, 106.5, 104.5, 106),
        candle(1, 106.2, 106.4, 103.8, 104),
        // Lower engulfing supply becomes the EVENT after the rally closes above it.
        candle(2, 100, 101.2, 99.8, 101),
        candle(3, 101.1, 101.3, 99.4, 99.5),
        candle(4, 99.5, 99.7, 97.5, 98),
        candle(5, 98, 98.2, 96.8, 97),
        candle(6, 97, 100.2, 96.9, 100),
        candle(7, 100, 102.2, 99.8, 102),
    ];
}

function razorThinLongSetup(): Candle[] {
    return validLongSetup().map((item, index) => index === 5
        ? candle(5, 98, 98.2, 97.9, 97.95)
        : item);
}

describe('Chain Strategy scanner', () => {
    it('generates the mirrored short setup with a stop above entry and target below', () => {
        const candles = validLongSetup().map((bar) => ({
            ...bar, open: 200 - bar.open, high: 200 - bar.low,
            low: 200 - bar.high, close: 200 - bar.close,
        }));
        const result = scanForSignals(candles, 'BTC', '1h');
        const short = result.newSignals.find((signal) => signal.direction === 'SHORT');
        expect(short).toBeDefined();
        expect(short?.entryPrice).toBe(102);
        expect(short!.stopLoss).toBeGreaterThan(short!.entryPrice);
        expect(short?.takeProfit).toBe(95);
    });
    it('keeps signal and zone identities when the snapshot starts one candle earlier', () => {
        const candles = validLongSetup();
        const first = scanForSignals(candles, 'BTC', '1h');
        const expanded = [candle(-1, 107, 107, 107, 107), ...candles];
        const fresh = scanForSignals(expanded, 'BTC', '1h');
        expect(fresh.newSignals[0].id).toBe(first.newSignals[0].id);
        expect(fresh.newSignals[0].originZone.id).toBe(first.newSignals[0].originZone.id);

        const next = scanForSignals(expanded, 'BTC', '1h', first.state);
        expect(next.newSignals).toHaveLength(0);
        expect(next.state.zones.every((zone) => expanded[zone.createdAtIndex]?.time === zone.createdAt)).toBe(true);
        expect(new Set(next.state.zones.map((zone) => `${zone.type}:${zone.createdAt}`)).size).toBe(next.state.zones.length);
    });

    it('does not use an opposing target zone formed after the trigger candle', () => {
        const candles = validLongSetup().slice(2);
        candles.push(candle(8, 105, 106.5, 104.5, 106), candle(9, 106.2, 106.4, 103.8, 104));
        const result = scanForSignals(candles, 'BTC', '1h');
        expect(result.newSignals.some((signal) => signal.triggerCandleTime === START + 7 * HOUR)).toBe(false);
    });

    it.each([
        { name: 'entry already touched', next: candle(8, 102, 103, 97.5, 99) },
        { name: 'target already reached', next: candle(8, 102, 107, 101, 102) },
    ])('does not offer a historical setup with $name as a fresh pending plan', ({ next }) => {
        const result = scanForSignals([...validLongSetup(), next], 'BTC', '1h');
        expect(result.newSignals.some((signal) => signal.triggerCandleTime === START + 7 * HOUR)).toBe(false);
    });

    it('creates a stable actionable signal with entry, stop, opposing-zone target, and R:R', () => {
        const candles = validLongSetup();
        const first = scanForSignals(candles, 'BTC', '1h');
        const signal = first.state.signals.find((item) => item.status === 'PENDING');

        expect(signal).toBeDefined();
        expect(signal?.direction).toBe('LONG');
        expect(signal?.entryPrice).toBeCloseTo(98);
        expect(signal?.stopLoss).toBeLessThan(96.8);
        expect(signal?.takeProfit).toBeCloseTo(105);
        expect(signal?.riskRewardRatio).toBeGreaterThanOrEqual(2);

        const second = scanForSignals(candles, 'BTC', '1h', first.state);
        expect(second.newSignals).toHaveLength(0);
        expect(second.state.signals.filter((item) => item.status === 'PENDING')).toHaveLength(1);
        expect(second.state.signals[0].id).toBe(signal?.id);
    });

    it('invalidates a setup after a close through the origin distal line', () => {
        const candles = validLongSetup();
        const first = scanForSignals(candles, 'BTC', '1h');
        const invalidation = candle(8, 98, 98.4, 95.8, 96.5);
        const second = scanForSignals([...candles, invalidation], 'BTC', '1h', first.state);

        expect(second.state.signals.some((item) => item.status === 'PENDING')).toBe(false);
        expect(second.state.signals.some((item) => item.status === 'INVALIDATED')).toBe(true);
        expect(second.invalidatedSignals).toHaveLength(1);
        expect(second.invalidatedSignals[0].status).toBe('INVALIDATED');
    });

    it('reports an approved setup invalidated at candle close', () => {
        const candles = validLongSetup();
        const first = scanForSignals(candles, 'BTC', '1h');
        const approvedState = {
            ...first.state,
            signals: first.state.signals.map((signal) => ({
                ...signal,
                status: 'APPROVED' as const,
            })),
        };
        const invalidation = candle(8, 98, 98.4, 95.8, 96.5);
        const second = scanForSignals([...candles, invalidation], 'BTC', '1h', approvedState);

        expect(second.invalidatedSignals).toHaveLength(1);
        expect(second.state.signals.some((item) => item.status === 'INVALIDATED')).toBe(true);
    });

    it('does not fabricate a percentage target when no opposing zone exists', () => {
        const candles = validLongSetup().slice(2).map((item, index) => ({
            ...item,
            time: START + (index * HOUR),
        }));
        const result = scanForSignals(candles, 'BTC', '1h');

        expect(result.state.signals.filter((item) => item.status === 'PENDING')).toHaveLength(0);
    });
});

describe('setup quality gate', () => {
    const thresholds = {
        minRiskReward: 2,
        minStopDistancePercent: 0.4,
        maxRiskRewardRatio: 8,
    };

    it('rejects a razor-thin 0.2% stop', () => {
        expect(passesSetupQualityGate(100, 99.8, 3, thresholds)).toBe(false);
    });

    it('rejects a degenerate 1:30 reward ratio', () => {
        expect(passesSetupQualityGate(100, 99, 30, thresholds)).toBe(false);
    });

    it('keeps inclusive stop-distance and reward-ratio boundaries', () => {
        expect(passesSetupQualityGate(100, 99.6, 2, thresholds)).toBe(true);
        expect(passesSetupQualityGate(100, 99.6, 8, thresholds)).toBe(true);
    });

    it('rejects a scanner candidate whose origin produces a roughly 0.2% stop', () => {
        const result = scanForSignals(razorThinLongSetup(), 'SOL', '1h', undefined, {
            minRiskReward: 2,
            minStopDistancePercent: 0.4,
            maxRiskRewardRatio: 100,
        });

        expect(result.state.signals.filter((signal) => signal.status === 'PENDING')).toHaveLength(0);
    });

    it('rejects a scanner candidate above the configured reward-ratio cap', () => {
        const result = scanForSignals(razorThinLongSetup(), 'DOGE', '1h', undefined, {
            minRiskReward: 2,
            minStopDistancePercent: 0,
            maxRiskRewardRatio: 30,
        });

        expect(result.state.signals.filter((signal) => signal.status === 'PENDING')).toHaveLength(0);
    });

    it('accepts scanner candidates exactly on their configured quality boundaries', () => {
        const baseline = scanForSignals(validLongSetup(), 'BTC', '1h', undefined, {
            minStopDistancePercent: 0,
            maxRiskRewardRatio: 100,
        });
        const candidate = baseline.newSignals[0];
        expect(candidate).toBeDefined();

        const stopDistancePercent = (Math.abs(candidate.entryPrice - candidate.stopLoss) / candidate.entryPrice) * 100;
        const boundary = scanForSignals(validLongSetup(), 'BTC', '1h', undefined, {
            minRiskReward: candidate.riskRewardRatio,
            minStopDistancePercent: stopDistancePercent,
            maxRiskRewardRatio: candidate.riskRewardRatio,
        });

        expect(boundary.newSignals).toHaveLength(1);
    });
});
