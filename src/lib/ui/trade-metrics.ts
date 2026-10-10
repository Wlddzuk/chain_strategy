import type { ChainSignal, PositionSize } from '@/lib/trading/types';
import { getMoveToEntryPercent } from '@/lib/trading/entry-distance';

export interface NetRiskRewardMetrics {
    netRiskPercent: number;
    netRewardPercent: number;
    ratio: number;
}

export interface FeeRates {
    makerFeePercent: number;
    takerFeePercent: number;
}

/** Hyperliquid perps base tier: under $5M 14-day volume, no staking discount. */
export const HYPERLIQUID_BASE_FEES: FeeRates = {
    makerFeePercent: 0.015,
    takerFeePercent: 0.045,
};

/**
 * Fees for a full plan as a percent of notional. The entry and target rest as
 * limit orders (maker); the stop exits at market (taker).
 */
export function getPlanFeePercents(fees: FeeRates): { win: number; loss: number } {
    const maker = Number.isFinite(fees.makerFeePercent) ? Math.max(0, fees.makerFeePercent) : 0;
    const taker = Number.isFinite(fees.takerFeePercent) ? Math.max(0, fees.takerFeePercent) : 0;
    return { win: maker * 2, loss: maker + taker };
}

export function calculateNetRiskReward(
    entryPrice: number,
    stopLoss: number,
    takeProfit: number,
    fees: FeeRates
): NetRiskRewardMetrics {
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
        return { netRiskPercent: 0, netRewardPercent: 0, ratio: 0 };
    }

    const stopDistancePercent = (Math.abs(entryPrice - stopLoss) / entryPrice) * 100;
    const targetDistancePercent = (Math.abs(takeProfit - entryPrice) / entryPrice) * 100;
    const planFees = getPlanFeePercents(fees);
    const netRiskPercent = stopDistancePercent + planFees.loss;
    const netRewardPercent = Math.max(0, targetDistancePercent - planFees.win);
    const ratio = netRiskPercent > 0 && netRewardPercent > 0
        ? netRewardPercent / netRiskPercent
        : 0;

    if (![netRiskPercent, netRewardPercent, ratio].every(Number.isFinite)) {
        return { netRiskPercent: 0, netRewardPercent: 0, ratio: 0 };
    }

    return { netRiskPercent, netRewardPercent, ratio };
}

export function isPositionSizingUnsafe(
    position: Pick<PositionSize, 'notionalValue' | 'marginRequired'>,
    accountEquity: number,
    leverage: number
): boolean {
    if (
        !Number.isFinite(position.notionalValue) ||
        !Number.isFinite(position.marginRequired) ||
        !Number.isFinite(accountEquity) ||
        !Number.isFinite(leverage) ||
        accountEquity <= 0 ||
        leverage <= 0
    ) {
        return true;
    }

    return position.notionalValue > accountEquity * leverage ||
        position.marginRequired > accountEquity * 0.5;
}

export function sortActiveSignalsByActionability(
    signals: readonly ChainSignal[],
    prices: Readonly<Record<string, number>>,
    approachThresholdPercent: number
): ChainSignal[] {
    const threshold = Number.isFinite(approachThresholdPercent)
        ? Math.max(0, approachThresholdPercent)
        : 0;

    return [...signals].sort((first, second) => {
        const firstDistance = Math.abs(
            getMoveToEntryPercent(prices[first.coin], first.entryPrice)
        );
        const secondDistance = Math.abs(
            getMoveToEntryPercent(prices[second.coin], second.entryPrice)
        );
        const firstGroup = getActionabilityGroup(first, firstDistance, threshold);
        const secondGroup = getActionabilityGroup(second, secondDistance, threshold);

        if (firstGroup !== secondGroup) return firstGroup - secondGroup;
        if (firstDistance !== secondDistance) return firstDistance - secondDistance;
        if (first.createdAt !== second.createdAt) return second.createdAt - first.createdAt;
        return first.id.localeCompare(second.id);
    });
}

function getActionabilityGroup(
    signal: ChainSignal,
    distancePercent: number,
    approachThresholdPercent: number
): number {
    if (signal.status === 'TOUCHED') return 0;
    if (distancePercent <= approachThresholdPercent) return 1;
    return 2;
}
