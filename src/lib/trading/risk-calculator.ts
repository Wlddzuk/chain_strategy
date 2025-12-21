// Risk Calculator Module
// Implements position sizing per Chain Strategy Section 6

import { TradeParams, PositionSize } from './types';

/**
 * Calculate position size using the strategy formula:
 * Position Size = (Risk_Amount / Distance_to_Stop_Percent) * Leverage
 * 
 * @param params - Trade parameters including equity, risk%, leverage, entry, and stop loss
 * @returns Position size details
 */
export function calculatePositionSize(params: TradeParams): PositionSize {
    const { equity, riskPercent, leverage, entryPrice, stopLoss } = params;

    // Calculate risk amount in USD
    const riskAmount = equity * (riskPercent / 100);

    // Calculate stop distance as a percentage
    const stopDistancePercent = Math.abs(entryPrice - stopLoss) / entryPrice;

    // Avoid division by zero
    if (stopDistancePercent === 0) {
        return {
            positionSize: 0,
            riskAmount,
            stopDistancePercent: 0,
            notionalValue: 0,
        };
    }

    // Calculate position size using the formula
    // Position Size = (Risk_Amount / Stop_Distance_Percent) * Leverage
    const notionalValue = (riskAmount / stopDistancePercent) * leverage;

    // Position size in units (e.g., number of contracts or coins)
    const positionSize = notionalValue / entryPrice;

    return {
        positionSize,
        riskAmount,
        stopDistancePercent,
        notionalValue,
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

    if (params.equity <= 0) {
        errors.push('Equity must be greater than 0');
    }

    if (params.riskPercent <= 0 || params.riskPercent > 100) {
        errors.push('Risk percent must be between 0 and 100');
    }

    if (params.leverage < 1 || params.leverage > 100) {
        errors.push('Leverage must be between 1x and 100x');
    }

    if (params.entryPrice <= 0) {
        errors.push('Entry price must be greater than 0');
    }

    if (params.stopLoss <= 0) {
        errors.push('Stop loss must be greater than 0');
    }

    if (params.entryPrice === params.stopLoss) {
        errors.push('Entry price and stop loss cannot be the same');
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
