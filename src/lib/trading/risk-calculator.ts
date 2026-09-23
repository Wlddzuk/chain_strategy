// Risk Calculator Module
// Implements position sizing per Chain Strategy Section 6

import { TradeParams, PositionSize } from './types';

/**
 * Calculate a risk-capped position.
 *
 * Notional = Risk amount / fractional stop distance.
 * Margin = Notional / leverage.
 *
 * Leverage changes the collateral required, not the loss at the stop. Multiplying
 * notional by leverage would multiply the user's planned dollar risk as well.
 * 
 * @param params - Trade parameters including equity, risk%, leverage, entry, and stop loss
 * @returns Position size details
 */
export function calculatePositionSize(params: TradeParams): PositionSize {
    const { equity, riskPercent, leverage, entryPrice, stopLoss } = params;

    if (
        ![equity, riskPercent, leverage, entryPrice, stopLoss].every(Number.isFinite) ||
        equity <= 0 || riskPercent <= 0 || leverage < 1 || entryPrice <= 0 || stopLoss <= 0
    ) {
        return { positionSize: 0, riskAmount: 0, stopDistancePercent: 0, notionalValue: 0, marginRequired: 0 };
    }

    // Calculate risk amount in USD
    const riskAmount = equity * (riskPercent / 100);

    // Calculate stop distance as a percentage
    const stopDistancePercent = Math.abs(entryPrice - stopLoss) / entryPrice;

    // Avoid invalid and zero-distance calculations.
    if (!Number.isFinite(stopDistancePercent) || stopDistancePercent === 0) {
        return {
            positionSize: 0,
            riskAmount,
            stopDistancePercent: 0,
            notionalValue: 0,
            marginRequired: 0,
        };
    }

    const notionalValue = riskAmount / stopDistancePercent;
    const marginRequired = leverage > 0 ? notionalValue / leverage : 0;

    // Position size in units (e.g., number of contracts or coins)
    const positionSize = notionalValue / entryPrice;

    return {
        positionSize,
        riskAmount,
        stopDistancePercent,
        notionalValue,
        marginRequired,
    };
}

/**
 * Calculate risk/reward ratio
 */
export function calculateRiskReward(
    entryPrice: number,
    stopLoss: number,
    takeProfit: number
): number {
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);

    if (risk === 0) return 0;

    return reward / risk;
}

/**
 * Calculate potential profit/loss in USD
 */
export function calculatePnL(
    positionSize: number,
    entryPrice: number,
    exitPrice: number,
    direction: 'LONG' | 'SHORT'
): number {
    if (direction === 'LONG') {
        return positionSize * (exitPrice - entryPrice);
    } else {
        return positionSize * (entryPrice - exitPrice);
    }
}

/**
 * Validate trade parameters
 */
export function validateTradeParams(params: TradeParams): string[] {
    const errors: string[] = [];

    if (!Number.isFinite(params.equity) || params.equity <= 0) {
        errors.push('Equity must be greater than 0');
    }

    if (!Number.isFinite(params.riskPercent) || params.riskPercent < 0.1 || params.riskPercent > 10) {
        errors.push('Risk percent must be between 0.1 and 10');
    }

    if (!Number.isInteger(params.leverage) || params.leverage < 1 || params.leverage > 50) {
        errors.push('Leverage must be a whole number between 1x and 50x');
    }

    if (!Number.isFinite(params.entryPrice) || params.entryPrice <= 0) {
        errors.push('Entry must be greater than 0');
    }

    if (!Number.isFinite(params.stopLoss) || params.stopLoss <= 0) {
        errors.push('Stop must be greater than 0');
    }

    if (params.entryPrice === params.stopLoss) {
        errors.push('Entry and Stop cannot be the same');
    }

    const stopDistancePercent = Math.abs(params.entryPrice - params.stopLoss) / params.entryPrice;
    if (Number.isFinite(stopDistancePercent) && stopDistancePercent > 0.25) {
        errors.push('Stop distance exceeds 25% of Entry');
    }

    return errors;
}

/**
 * Format position size for display
 */
export function formatPositionSize(size: number, decimals: number = 4): string {
    return size.toFixed(decimals);
}

/**
 * Format USD value for display
 */
export function formatUSD(value: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
}

/**
 * Format percentage for display
 */
export function formatPercent(value: number): string {
    return `${(value * 100).toFixed(2)}%`;
}
