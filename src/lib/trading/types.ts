// Candle and Zone type definitions for the Chain Strategy trading engine

export interface Candle {
  time: number;      // Unix timestamp in milliseconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type CandleDirection = 'BULLISH' | 'BEARISH' | 'DOJI';

export interface Zone {
  id: string;
  type: 'SUPPLY' | 'DEMAND';
  proximalLine: number;  // Entry level
  distalLine: number;    // Stop loss level (wick)
  createdAt: number;     // Timestamp when zone was created
  createdAtIndex: number; // Candle index
  status: 'ACTIVE' | 'EVENT' | 'TESTED' | 'BROKEN';
  strength: number;      // 0-100, based on pattern type and RSI divergence
  originCandle: Candle;  // The reference candle that created the zone
}

export type FormationType = 'RBR' | 'DBD' | 'DBR' | 'RBD' | null;

export interface EngulfingPattern {
  type: 'BULLISH' | 'BEARISH';
  index: number;
  engulfingCandle: Candle;
  engulfedCandle: Candle;
}

export interface PinBar {
  type: 'BULLISH' | 'BEARISH';
  index: number;
  candle: Candle;
  wickRatio: number; // Ratio of wick to body (higher = stronger)
}

export interface ChainSignal {
  id: string;
  coin: string;
  timeframe: '15m' | '1h' | '4h';
  phase: 'IDENTIFICATION' | 'BREAK' | 'ORIGIN' | 'ENTRY';
  direction: 'LONG' | 'SHORT';
  eventZone: Zone;      // The broken zone (marked as EVENT)
  originZone: Zone;     // The new trading zone for entry
  entryPrice: number;   // Proximal line of origin zone
  stopLoss: number;     // Beyond distal line of origin zone
  takeProfit: number;   // Next opposing zone
  riskRewardRatio: number;
  confidence: number;   // 0-100, boosted by RSI divergence
  hasRsiDivergence: boolean;
  createdAt: number;
  status: 'PENDING' | 'APPROVED' | 'FILLED' | 'CANCELLED' | 'INVALIDATED';
}

export interface RsiDivergence {
  type: 'BULLISH' | 'BEARISH';
  pricePoint1: { index: number; value: number };
  pricePoint2: { index: number; value: number };
  rsiPoint1: { index: number; value: number };
  rsiPoint2: { index: number; value: number };
  strength: number; // 0-100
}

export interface TradeParams {
  equity: number;
  riskPercent: number;
  leverage: number;
  entryPrice: number;
  stopLoss: number;
}

export interface PositionSize {
  positionSize: number;
  riskAmount: number;
  stopDistancePercent: number;
  notionalValue: number;
}

// Utility functions for candle analysis
export function getCandleDirection(candle: Candle): CandleDirection {
  if (candle.close > candle.open) return 'BULLISH';
  if (candle.close < candle.open) return 'BEARISH';
  return 'DOJI';
}

export function getCandleBody(candle: Candle): number {
  return Math.abs(candle.close - candle.open);
}

export function getCandleRange(candle: Candle): number {
  return candle.high - candle.low;
}

export function getUpperWick(candle: Candle): number {
  const bodyTop = Math.max(candle.open, candle.close);
  return candle.high - bodyTop;
}

export function getLowerWick(candle: Candle): number {
  const bodyBottom = Math.min(candle.open, candle.close);
  return bodyBottom - candle.low;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
