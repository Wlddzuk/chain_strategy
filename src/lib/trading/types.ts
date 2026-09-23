// Candle and Zone type definitions for the Chain Strategy trading engine

export interface Candle {
  time: number;      // Unix timestamp in milliseconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = '5m' | '15m' | '1h' | '4h';

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

export type SignalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'TOUCHED'
  | 'FILLED'
  | 'MISSED'
  | 'CANCELLED'
  | 'INVALIDATED';

export type SignalOutcome = 'WIN' | 'LOSS';

export interface ExecutionChecklist {
  limitOrderPlaced: boolean;
  stopSet: boolean;
  takeProfitSet: boolean;
}

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
  timeframe: Timeframe;
  phase: 'IDENTIFICATION' | 'BREAK' | 'ORIGIN' | 'ENTRY';
  direction: 'LONG' | 'SHORT';
  eventZone: Zone;      // The broken zone (marked as EVENT)
  originZone: Zone;     // The new trading zone for entry
  entryPrice: number;   // Proximal line of origin zone
  stopLoss: number;     // Beyond distal line of origin zone
  takeProfit: number;   // Next opposing zone
  partialTakeProfit?: {
    price: number;
    riskReward: number;
    closePercent: number;
  };
  riskRewardRatio: number;
  confidence: number;   // 0-100, boosted by RSI divergence
  hasRsiDivergence: boolean;
  divergence?: RsiDivergence;
  higherTimeframe?: Timeframe;
  triggerCandleTime?: number;
  createdAt: number;
  expiresAt: number;
  status: SignalStatus;
  touchedAt?: number;
  filledAt?: number;
  outcome?: SignalOutcome;
  closedAt?: number;
  executionChecklist?: ExecutionChecklist;
  sizing?: Pick<TradeParams, 'equity' | 'riskPercent' | 'leverage'>;
}

export interface RsiDivergence {
  type: 'BULLISH' | 'BEARISH';
  pricePoint1: { index: number; value: number; time?: number };
  pricePoint2: { index: number; value: number; time?: number };
  rsiPoint1: { index: number; value: number; time?: number };
  rsiPoint2: { index: number; value: number; time?: number };
  strength: number; // 0-100
  // Every touch of a three-touch divergence, oldest first. Signals saved
  // before three-touch detection only carry the two end points.
  touches?: Array<{ index: number; time: number; price: number; rsi: number }>;
}

export interface TradeParams {
  equity: number;
  riskPercent: number;
  leverage: number;
  entryPrice: number;
  stopLoss: number;
}

export interface PositionSize {
  positionSize: number;       // Quantity of the asset/contracts
  riskAmount: number;         // Maximum planned loss at the stop, before fees/slippage
  stopDistancePercent: number; // Decimal fraction, e.g. 0.005 = 0.5%
  notionalValue: number;      // Dollar exposure required to risk riskAmount at the stop
  marginRequired: number;     // Estimated collateral at the selected leverage
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

export function getTimeframeMs(timeframe: Timeframe): number {
  const durations: Record<Timeframe, number> = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
  };

  return durations[timeframe];
}
