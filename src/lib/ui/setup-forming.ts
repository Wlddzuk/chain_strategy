import type { ChainStrategyState } from '@/lib/trading/chain-strategy';
import { getTimeframeMs, type Timeframe, type Zone } from '@/lib/trading/types';

const SCANNED_TIMEFRAMES: readonly Timeframe[] = ['5m', '15m', '1h', '4h'];

export type ZonePriceRelation = 'above' | 'below' | 'inside';

export interface FormingSetup {
    marketKey: string;
    coin: string;
    timeframe: Timeframe;
    zone: Zone;
    currentPrice: number;
    distancePercent: number;
    priceRelation: ZonePriceRelation;
    breakForming: boolean;
}

export type FormingStrategyStates = Readonly<
    Record<string, Partial<Record<Timeframe, ChainStrategyState>>>
>;

export function getBreakFormingAlertKey(
    coin: string,
    timeframe: Timeframe,
    zoneId: string,
    now: number
): string {
    const duration = getTimeframeMs(timeframe);
    const periodStart = Number.isFinite(now)
        ? Math.floor(now / duration) * duration
        : 0;

    return `${coin}:${timeframe}:${zoneId}:${periodStart}`;
}

export function isBreakForming(zone: Zone, currentPrice: number): boolean {
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return false;

    return zone.type === 'SUPPLY'
        ? currentPrice > zone.distalLine
        : currentPrice < zone.distalLine;
}

export function getZoneProximity(
    zone: Zone,
    currentPrice: number
): { distancePercent: number; priceRelation: ZonePriceRelation } {
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        return {
            distancePercent: Number.POSITIVE_INFINITY,
            priceRelation: 'inside',
        };
    }

    const lowerBound = Math.min(zone.proximalLine, zone.distalLine);
    const upperBound = Math.max(zone.proximalLine, zone.distalLine);

    if (currentPrice < lowerBound) {
        return {
            distancePercent: ((lowerBound - currentPrice) / currentPrice) * 100,
            priceRelation: 'below',
        };
    }

    if (currentPrice > upperBound) {
        return {
            distancePercent: ((currentPrice - upperBound) / currentPrice) * 100,
            priceRelation: 'above',
        };
    }

    return { distancePercent: 0, priceRelation: 'inside' };
}

export function deriveFormingSetups(
    strategyStates: FormingStrategyStates,
    prices: Readonly<Record<string, number>>,
    maxDistancePercent = 5,
    maxRows = 8
): FormingSetup[] {
    const distanceLimit = Number.isFinite(maxDistancePercent)
        ? Math.max(0, maxDistancePercent)
        : 0;
    const rowLimit = Number.isFinite(maxRows)
        ? Math.max(0, Math.floor(maxRows))
        : 0;
    const setups: FormingSetup[] = [];

    for (const [coin, markets] of Object.entries(strategyStates)) {
        const currentPrice = prices[coin];
        if (!Number.isFinite(currentPrice) || currentPrice <= 0) continue;

        for (const timeframe of SCANNED_TIMEFRAMES) {
            const state = markets[timeframe];
            if (!state) continue;

            const nearestZone = state.zones
                .filter((zone) => zone.status === 'ACTIVE')
                .map((zone) => ({ zone, ...getZoneProximity(zone, currentPrice) }))
                .filter(({ distancePercent }) => distancePercent <= distanceLimit)
                .sort((first, second) =>
                    first.distancePercent - second.distancePercent ||
                    second.zone.createdAt - first.zone.createdAt
                )[0];

            if (!nearestZone) continue;

            setups.push({
                marketKey: `${coin}:${timeframe}`,
                coin,
                timeframe,
                zone: nearestZone.zone,
                currentPrice,
                distancePercent: nearestZone.distancePercent,
                priceRelation: nearestZone.priceRelation,
                breakForming: isBreakForming(nearestZone.zone, currentPrice),
            });
        }
    }

    return setups
        .sort((first, second) =>
            first.distancePercent - second.distancePercent ||
            second.zone.createdAt - first.zone.createdAt ||
            first.marketKey.localeCompare(second.marketKey)
        )
        .slice(0, rowLimit);
}

/**
 * Break candidates must not be hidden by the compact forming-setups row cap or
 * by a different, nearer zone in the same market.
 */
export function deriveBreakFormingSetups(
    strategyStates: FormingStrategyStates,
    prices: Readonly<Record<string, number>>
): FormingSetup[] {
    const setups: FormingSetup[] = [];

    for (const [coin, markets] of Object.entries(strategyStates)) {
        const currentPrice = prices[coin];
        if (!Number.isFinite(currentPrice) || currentPrice <= 0) continue;

        for (const timeframe of SCANNED_TIMEFRAMES) {
            const state = markets[timeframe];
            if (!state) continue;

            for (const zone of state.zones) {
                if (zone.status !== 'ACTIVE' || !isBreakForming(zone, currentPrice)) continue;
                const proximity = getZoneProximity(zone, currentPrice);
                setups.push({
                    marketKey: `${coin}:${timeframe}`,
                    coin,
                    timeframe,
                    zone,
                    currentPrice,
                    distancePercent: proximity.distancePercent,
                    priceRelation: proximity.priceRelation,
                    breakForming: true,
                });
            }
        }
    }

    return setups.sort((first, second) => (
        first.distancePercent - second.distancePercent ||
        second.zone.createdAt - first.zone.createdAt ||
        first.marketKey.localeCompare(second.marketKey)
    ));
}
