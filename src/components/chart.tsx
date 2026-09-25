'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    type AutoscaleInfoProvider,
    CandlestickData,
    CandlestickSeries,
    HistogramSeries,
    IChartApi,
    IPaneApi,
    IPriceLine,
    ISeriesApi,
    ISeriesMarkersPluginApi,
    LineSeries,
    type Logical,
    LineStyle,
    MouseEventParams,
    SeriesMarker,
    Time,
    WhitespaceData,
    LineData,
    createChart,
    createSeriesMarkers,
} from 'lightweight-charts';
import {
    Activity,
    BarChart3,
    ChartCandlestick,
    ChevronsRight,
    Eye,
    EyeOff,
    GalleryVerticalEnd,
    Layers3,
    Magnet,
    Maximize2,
    Minimize2,
    Minus,
    MousePointer2,
    Redo2,
    Repeat2,
    RotateCcw,
    SeparatorHorizontal,
    Spline,
    Trash2,
    TrendingUp,
    Undo2,
    ZoomIn,
    ZoomOut,
} from 'lucide-react';
import ChartOverlaySvg, {
    estimateLabelWidth,
    type OverlayHandle,
    type OverlayModel,
} from '@/components/chart-overlay-svg';
import {
    calculateBollingerBands,
    calculateBollingerLastPoint,
    calculateRsiSeries,
    updateRsiLastPoint,
    type RsiIncrementalState,
} from '@/lib/chart/indicators';
import { canUpdateLastCandle, shouldFitAfterRebuild } from '@/lib/chart/candle-updates';
import {
    createDefaultPosition,
    editPosition,
    evaluatePosition,
    hitTestPosition,
    logicalToTime,
    positionGeometry,
    riskRewardRatio,
    timeToLogical,
    type PositionHandle,
    type PositionLevels,
    type PositionSide,
    type TimeAnchor,
} from '@/lib/chart/position-tool';
import { detectEngulfingPatterns, isDecisiveEngulfing } from '@/lib/trading/pattern-detector';
import { calculatePositionSize } from '@/lib/trading/risk-calculator';
import { calculateRSI, findTripleDivergences } from '@/lib/trading/rsi-divergence';
import { Candle, ChainSignal, RsiDivergence, Zone, getTimeframeMs } from '@/lib/trading/types';
import { findSupersededZoneIds } from '@/lib/trading/zone-marker';
import { findWickMidpoints, summarizeWickMidpoints, type WickMidpoint } from '@/lib/trading/wick-midpoint';
import { formatPrice } from '@/lib/ui/format-price';
import { formatCompactAge } from '@/lib/ui/signal-display';
import { useTradingStore } from '@/store/trading-store';

interface ChartProps {
    candles: Candle[];
    zones?: Zone[];
    isLoading?: boolean;
    showRsi: boolean;
    showBollinger: boolean;
    onToggleRsi: () => void;
    onToggleBollinger: () => void;
}

type DrawingMode = 'cursor' | 'trend' | 'horizontal' | 'fibonacci' | PositionSide;

interface DrawingPoint {
    time: number;
    price: number;
}

interface Drawing {
    id: string;
    type: Exclude<DrawingMode, 'cursor'>;
    start: DrawingPoint;
    end?: DrawingPoint;
    /** Long/short positions: start = entry, end = target price at the box's right edge. */
    stop?: number;
}

interface OverlayInputs {
    zones: Zone[];
    supersededZoneIds: Set<string>;
    showZones: boolean;
    signal: ChainSignal | null;
    drawings: Drawing[];
    showAutoFib: boolean;
    autoFib: { start: DrawingPoint; end: DrawingPoint } | null;
    draftAnchor: DrawingPoint | null;
    selectedDrawingId: string | null;
    drawingsVisible: boolean;
    divergences: RsiDivergence[];
    showDivergences: boolean;
    wickLevels: WickMidpoint[];
    showWickLevels: boolean;
    candles: Candle[];
    timeAnchor: TimeAnchor | null;
    positionRisk: { equity: number; riskPercent: number };
    hoveredDrawingId?: string | null;
    positionPreview?: PositionLevels | null;
}

interface DragState {
    id: string;
    origin: Drawing;
    start: DrawingPoint;
    pointerId: number;
    /** Set when dragging part of a long/short position. */
    handle?: PositionHandle;
}

/** Pointer state that changes every frame; kept out of React so dragging stays at 60fps. */
interface LiveInteraction {
    drawing: Drawing | null;
    hoverId: string | null;
    preview: PositionLevels | null;
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
const CHART_ACCENT = '#4d8dff';
const PRICE_SCALE_WIDTH = 64;

const DIVERGENCE_COLORS = { BULLISH: '#22c55e', BEARISH: '#ef5350' };
const WICK_COLORS = { BULLISH: '#22d3ee', BEARISH: '#f472b6' };
// How many of the chart's patterns to draw at once, newest first.
const MAX_DIVERGENCES_SHOWN = 6;
const MAX_OPEN_WICKS_SHOWN = 4;
const MAX_FILLED_WICKS_SHOWN = 6;

const ZONE_COLORS = {
    DEMAND: { fill: 'rgba(0, 210, 106, 0.13)', border: '#00d26a' },
    SUPPLY: { fill: 'rgba(255, 71, 87, 0.13)', border: '#ff4757' },
    EVENT: { fill: 'rgba(148, 163, 184, 0.08)', border: '#64748b' },
};

// Older zones a newer engulfing has superseded: still drawn, but muted.
const POSITION_COLORS = {
    reward: 'rgba(0, 210, 106, 0.2)',
    rewardActive: 'rgba(0, 210, 106, 0.28)',
    risk: 'rgba(255, 71, 87, 0.2)',
    riskActive: 'rgba(255, 71, 87, 0.28)',
    target: '#00d26a',
    stop: '#ff4757',
    entry: '#d1d4dc',
    targetLabel: 'rgba(0, 150, 76, 0.94)',
    stopLabel: 'rgba(214, 48, 64, 0.94)',
};

const SUPERSEDED_ZONE_COLORS = {
    DEMAND: { fill: 'rgba(0, 210, 106, 0.035)', border: 'rgba(0, 210, 106, 0.32)' },
    SUPPLY: { fill: 'rgba(255, 71, 87, 0.035)', border: 'rgba(255, 71, 87, 0.32)' },
};

function drawingId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `drawing-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Every live supply/demand zone plus the latest EVENT. */
function getChartZones(zones: Zone[]): Zone[] {
    const live = zones.filter((zone) => zone.status === 'ACTIVE' || zone.status === 'TESTED');
    const event = zones
        .filter((zone) => zone.status === 'EVENT')
        .sort((first, second) => second.createdAt - first.createdAt)
        .slice(0, 1);

    return Array.from(new Map([...live, ...event].map((zone) => [zone.id, zone])).values());
}

function calculateEma(candles: Candle[], period: number) {
    if (candles.length === 0) return [];
    const multiplier = 2 / (period + 1);
    let ema = candles[0].close;

    return candles.map((candle, index) => {
        ema = index === 0 ? candle.close : ((candle.close - ema) * multiplier) + ema;
        return { time: (candle.time / 1000) as Time, value: ema };
    });
}

interface EmaCursor {
    lastTime: number | null;
    lastValue: number | null;
    previousClosedValue: number | null;
}

function createEmaCursor(): EmaCursor {
    return { lastTime: null, lastValue: null, previousClosedValue: null };
}

function seedEmaCursor(
    cursor: EmaCursor,
    candles: Candle[],
    data: ReturnType<typeof calculateEma>
) {
    const latestCandle = candles[candles.length - 1];
    const latestPoint = data[data.length - 1];
    const previousPoint = data[data.length - 2];
    cursor.lastTime = latestCandle?.time ?? null;
    cursor.lastValue = latestPoint?.value ?? null;
    cursor.previousClosedValue = previousPoint?.value ?? null;
}

function advanceEmaCursor(cursor: EmaCursor, candle: Candle, period: number) {
    const time = (candle.time / 1000) as Time;
    if (cursor.lastTime === null || cursor.lastValue === null) {
        cursor.lastTime = candle.time;
        cursor.lastValue = candle.close;
        cursor.previousClosedValue = null;
        return { time, value: candle.close };
    }

    const multiplier = 2 / (period + 1);
    if (candle.time === cursor.lastTime) {
        const base = cursor.previousClosedValue;
        const value = base === null ? candle.close : ((candle.close - base) * multiplier) + base;
        cursor.lastValue = value;
        return { time, value };
    }

    const previousValue = cursor.lastValue;
    const value = ((candle.close - previousValue) * multiplier) + previousValue;
    cursor.previousClosedValue = previousValue;
    cursor.lastTime = candle.time;
    cursor.lastValue = value;
    return { time, value };
}

function divergenceTouches(divergence: RsiDivergence) {
    return divergence.touches ?? [
        { index: divergence.pricePoint1.index, time: divergence.pricePoint1.time ?? NaN, price: divergence.pricePoint1.value, rsi: divergence.rsiPoint1.value },
        { index: divergence.pricePoint2.index, time: divergence.pricePoint2.time ?? NaN, price: divergence.pricePoint2.value, rsi: divergence.rsiPoint2.value },
    ];
}

/**
 * One RSI line series per direction: each divergence is a run of points, with
 * a whitespace gap after it so separate patterns are not joined together.
 * Times must strictly increase, so a touch shared by two patterns is kept once.
 */
function buildRsiDivergenceData(candles: Candle[], divergences: RsiDivergence[]) {
    const firstTime = candles[0]?.time;
    const lastTime = candles.at(-1)?.time;
    if (firstTime === undefined || lastTime === undefined) return [];
    const inRange = (time: number) => Number.isFinite(time) && time >= firstTime && time <= lastTime;
    const data: Array<LineData<Time> | WhitespaceData<Time>> = [];
    let lastPlotted = -Infinity;
    const sorted = [...divergences].sort((a, b) =>
        (divergenceTouches(a)[0]?.time ?? 0) - (divergenceTouches(b)[0]?.time ?? 0)
    );

    sorted.forEach((divergence, position) => {
        const touches = divergenceTouches(divergence).filter((touch) => inRange(touch.time));
        if (touches.length < 2) return;
        for (const touch of touches) {
            if (touch.time <= lastPlotted) continue;
            data.push({ time: (touch.time / 1000) as Time, value: touch.rsi });
            lastPlotted = touch.time;
        }
        const gapTime = candles[touches[touches.length - 1].index + 1]?.time;
        const nextStart = divergenceTouches(sorted[position + 1] ?? divergence)[0]?.time;
        if (gapTime !== undefined && gapTime > lastPlotted && (position === sorted.length - 1 || nextStart > gapTime)) {
            data.push({ time: (gapTime / 1000) as Time });
            lastPlotted = gapTime;
        }
    });
    return data;
}

function distanceToSegment(
    pointX: number,
    pointY: number,
    startX: number,
    startY: number,
    endX: number,
    endY: number
): number {
    const segmentX = endX - startX;
    const segmentY = endY - startY;
    const lengthSquared = (segmentX * segmentX) + (segmentY * segmentY);
    if (lengthSquared === 0) return Math.hypot(pointX - startX, pointY - startY);
    const projection = Math.max(0, Math.min(1, (((pointX - startX) * segmentX) + ((pointY - startY) * segmentY)) / lengthSquared));
    return Math.hypot(pointX - (startX + (projection * segmentX)), pointY - (startY + (projection * segmentY)));
}

function findDrawingAtPoint(
    chart: IChartApi,
    series: ISeriesApi<'Candlestick'>,
    drawings: Drawing[],
    x: number,
    y: number
): Drawing | null {
    const timeX = (time: number) => chart.timeScale().timeToCoordinate((time / 1000) as Time);
    const priceY = (price: number) => series.priceToCoordinate(price);

    for (const drawing of [...drawings].reverse()) {
        const startX = timeX(drawing.start.time);
        const startY = priceY(drawing.start.price);
        if (startX === null || startY === null) continue;

        if (drawing.type === 'horizontal' && Math.abs(y - startY) <= 8) return drawing;
        if (!drawing.end) continue;

        const endX = timeX(drawing.end.time);
        const endY = priceY(drawing.end.price);
        if (endX === null || endY === null) continue;

        if (drawing.type === 'trend' && distanceToSegment(x, y, startX, startY, endX, endY) <= 9) {
            return drawing;
        }

        if (drawing.type === 'fibonacci') {
            const left = Math.min(startX, endX);
            if (x < left - 10) continue;
            const delta = drawing.end.price - drawing.start.price;
            const nearLevel = FIB_LEVELS.some((level) => {
                const levelY = priceY(drawing.end!.price - (delta * level));
                return levelY !== null && Math.abs(y - levelY) <= 7;
            });
            if (nearLevel) return drawing;
        }
    }

    return null;
}

function getAutoFibAnchors(candles: Candle[]): { start: DrawingPoint; end: DrawingPoint } | null {
    const window = candles.slice(-80);
    if (window.length < 10) return null;

    const high = window.reduce((highest, candle) => candle.high > highest.high ? candle : highest);
    const low = window.reduce((lowest, candle) => candle.low < lowest.low ? candle : lowest);

    if (high.high === low.low) return null;
    if (low.time <= high.time) {
        return {
            start: { time: low.time, price: low.low },
            end: { time: high.time, price: high.high },
        };
    }

    return {
        start: { time: high.time, price: high.high },
        end: { time: low.time, price: low.low },
    };
}

function isStoredDrawing(value: unknown): value is Drawing {
    if (!value || typeof value !== 'object') return false;
    const drawing = value as Partial<Drawing>;
    const hasStart = Boolean(
        drawing.id &&
        drawing.type &&
        drawing.start &&
        Number.isFinite(drawing.start.time) &&
        Number.isFinite(drawing.start.price)
    );
    if (!hasStart || (drawing.type !== 'long' && drawing.type !== 'short')) return hasStart;
    return Boolean(
        drawing.end &&
        Number.isFinite(drawing.end.time) &&
        Number.isFinite(drawing.end.price) &&
        Number.isFinite(drawing.stop)
    );
}

function positionOf(drawing: Drawing): PositionLevels | null {
    if ((drawing.type !== 'long' && drawing.type !== 'short') || !drawing.end || drawing.stop === undefined) return null;
    return {
        side: drawing.type,
        entryTime: drawing.start.time,
        endTime: drawing.end.time,
        entry: drawing.start.price,
        stop: drawing.stop,
        target: drawing.end.price,
    };
}

function positionDrawing(id: string, levels: PositionLevels): Drawing {
    return {
        id,
        type: levels.side,
        start: { time: levels.entryTime, price: levels.entry },
        end: { time: levels.endTime, price: levels.target },
        stop: levels.stop,
    };
}

function describePosition(levels: PositionLevels): string {
    return `${levels.side === 'long' ? 'Long' : 'Short'} · entry ${formatPrice(levels.entry)} · stop ${formatPrice(levels.stop)} · target ${formatPrice(levels.target)} · R:R ${riskRewardRatio(levels).toFixed(2)}`;
}

function formatQuantity(quantity: number): string {
    if (quantity >= 100) return quantity.toFixed(0);
    if (quantity >= 1) return quantity.toFixed(2);
    return quantity.toPrecision(3);
}

function formatUsd(amount: number): string {
    return `$${Math.round(amount).toLocaleString('en-US')}`;
}

function formatSignedPercent(value: number): string {
    return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
}

function formatR(r: number): string {
    return `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(2)}R`;
}

/** Time-to-x through logical indexes, so positions can extend past the last candle. */
function anchoredTimeX(chart: IChartApi, anchor: TimeAnchor | null, time: number): number | null {
    if (!anchor) return chart.timeScale().timeToCoordinate((time / 1000) as Time);
    return chart.timeScale().logicalToCoordinate(timeToLogical(anchor, time) as Logical);
}

function findPositionAtPoint(
    chart: IChartApi,
    series: ISeriesApi<'Candlestick'>,
    anchor: TimeAnchor | null,
    drawings: Drawing[],
    x: number,
    y: number
): { drawing: Drawing; handle: PositionHandle } | null {
    for (const drawing of [...drawings].reverse()) {
        const levels = positionOf(drawing);
        if (!levels) continue;
        const geometry = positionGeometry(
            levels,
            (time) => anchoredTimeX(chart, anchor, time),
            (price) => series.priceToCoordinate(price)
        );
        const handle = geometry && hitTestPosition(geometry, x, y);
        if (handle) return { drawing, handle };
    }
    return null;
}

function positionCursor(handle: PositionHandle): string {
    if (handle === 'body') return 'move';
    return handle === 'width' ? 'ew-resize' : 'ns-resize';
}

function buildOverlayModel(
    chart: IChartApi,
    series: ISeriesApi<'Candlestick'>,
    width: number,
    height: number,
    inputs: OverlayInputs
): OverlayModel {
    const model: OverlayModel = { width, height, rects: [], lines: [], texts: [], circles: [] };
    const plotWidth = Math.max(0, width - PRICE_SCALE_WIDTH);
    const mainPaneHeight = series.getPane().getHeight();
    const priceY = (price: number) => series.priceToCoordinate(price);
    const timeX = (time: number) => chart.timeScale().timeToCoordinate((time / 1000) as Time);

    const addZone = (
        zone: Zone,
        options: {
            idPrefix?: string;
            fill: string;
            border: string;
            label: string;
            lineWidth?: number;
            hatch?: boolean;
        }
    ) => {
        const proximal = priceY(zone.proximalLine);
        const distal = priceY(zone.distalLine);
        if (proximal === null || distal === null) return;
        const top = Math.min(proximal, distal);
        const zoneHeight = Math.max(1, Math.abs(proximal - distal));
        const idPrefix = options.idPrefix ?? zone.id;
        // The box starts at the candle that made the zone and extends right.
        const originX = timeX(zone.createdAt);
        const left = originX === null ? 0 : Math.max(0, Math.min(originX - 4, plotWidth - 24));
        const boxWidth = Math.max(0, plotWidth - left);
        model.rects.push({
            id: `${idPrefix}-fill`,
            x: left,
            y: top,
            width: boxWidth,
            height: zoneHeight,
            fill: options.fill,
        });
        if (options.hatch) {
            model.rects.push({
                id: `${idPrefix}-hatch`,
                x: left,
                y: top,
                width: boxWidth,
                height: zoneHeight,
                fill: 'url(#chart-event-zone-hatch)',
            });
        }
        model.lines.push(
            { id: `${idPrefix}-top`, x1: left, y1: top, x2: plotWidth, y2: top, color: options.border, width: options.lineWidth ?? 1 },
            { id: `${idPrefix}-bottom`, x1: left, y1: top + zoneHeight, x2: plotWidth, y2: top + zoneHeight, color: options.border, width: options.lineWidth ?? 1 }
        );
        model.texts.push({
            id: `${idPrefix}-label`,
            x: left + 8,
            y: top + 13,
            text: options.label,
            color: options.border,
            size: 10,
            weight: 700,
        });
    };

    if (inputs.showZones) {
        const plottedZoneIds = new Set(inputs.signal
            ? [inputs.signal.originZone.id, inputs.signal.eventZone.id]
            : []);
        // Superseded zones first so the current ones draw on top.
        const ordered = [...inputs.zones].sort((first, second) =>
            Number(inputs.supersededZoneIds.has(second.id)) - Number(inputs.supersededZoneIds.has(first.id))
        );
        for (const zone of ordered) {
            if (plottedZoneIds.has(zone.id)) continue;
            const superseded = inputs.supersededZoneIds.has(zone.id);
            const colors = zone.status === 'EVENT'
                ? ZONE_COLORS.EVENT
                : superseded
                    ? SUPERSEDED_ZONE_COLORS[zone.type]
                    : ZONE_COLORS[zone.type];
            addZone(zone, {
                fill: colors.fill,
                border: colors.border,
                label: zone.status === 'EVENT' ? 'EVENT' : superseded ? `old ${zone.type.toLowerCase()}` : zone.type,
            });
        }
    }

    if (inputs.signal) {
        const signal = inputs.signal;
        const entry = priceY(signal.entryPrice);
        const stop = priceY(signal.stopLoss);
        const target = priceY(signal.takeProfit);
        if (entry !== null && stop !== null && target !== null) {
            model.rects.push(
                { id: 'signal-risk', x: 0, y: Math.min(entry, stop), width: plotWidth, height: Math.abs(entry - stop), fill: 'rgba(255,71,87,0.08)' },
                { id: 'signal-reward', x: 0, y: Math.min(entry, target), width: plotWidth, height: Math.abs(entry - target), fill: 'rgba(0,210,106,0.07)' }
            );
            addZone(signal.eventZone, {
                idPrefix: 'signal-event-zone',
                fill: 'rgba(100, 116, 139, 0.10)',
                border: '#94a3b8',
                label: 'EVENT — broken zone',
                hatch: true,
            });
            addZone(signal.originZone, {
                idPrefix: 'signal-origin-zone',
                fill: 'rgba(251, 191, 36, 0.20)',
                border: '#fbbf24',
                label: 'ORIGIN — entry zone',
                lineWidth: 2,
            });
            const triggerTime = signal.triggerCandleTime ?? signal.createdAt - getTimeframeMs(signal.timeframe);
            const triggerX = timeX(triggerTime);
            if (triggerX !== null) {
                model.lines.push({ id: 'signal-trigger', x1: triggerX, y1: 0, x2: triggerX, y2: mainPaneHeight, color: '#a78bfa', width: 1, dash: '4 5' });
                model.circles.push({ id: 'signal-trigger-dot', x: triggerX, y: entry, radius: 4, fill: '#fbbf24' });
                model.texts.push({
                    id: 'signal-trigger-label',
                    x: Math.max(6, Math.min(triggerX + 6, plotWidth - 92)),
                    y: 16,
                    text: 'break confirmed',
                    color: '#a78bfa',
                    size: 10,
                    weight: 700,
                });
                model.texts.push({
                    id: 'signal-trigger-age',
                    x: Math.max(6, Math.min(triggerX + 7, plotWidth - 36)),
                    y: entry < 28
                        ? Math.min(entry + 16, mainPaneHeight - 6)
                        : Math.max(12, entry - 8),
                    text: formatCompactAge(triggerTime, Date.now()),
                    color: '#fbbf24',
                    size: 10,
                    weight: 700,
                });
            }
        }
    }

    const addDivergence = (id: string, divergence: RsiDivergence) => {
        const color = DIVERGENCE_COLORS[divergence.type];
        const points = divergenceTouches(divergence).flatMap((touch) => {
            const x = timeX(touch.time);
            const y = priceY(touch.price);
            return x === null || y === null ? [] : [{ x: x as number, y: y as number }];
        });
        if (points.length < 2) return;
        points.slice(1).forEach((point, step) => {
            const from = points[step];
            model.lines.push({ id: `${id}-seg-${step}`, x1: from.x, y1: from.y, x2: point.x, y2: point.y, color, width: 2, dash: '2 4' });
        });
        points.forEach((point, step) => model.circles.push({ id: `${id}-touch-${step}`, x: point.x, y: point.y, radius: 3.5, fill: color }));
        const last = points[points.length - 1];
        const touches = divergenceTouches(divergence).length;
        model.texts.push({
            id: `${id}-label`,
            x: Math.max(4, Math.min(last.x - 30, plotWidth - 96)),
            y: divergence.type === 'BULLISH' ? Math.min(last.y + 16, mainPaneHeight - 4) : Math.max(12, last.y - 9),
            text: `${touches}-touch RSI div`,
            color,
            size: 10,
            weight: 700,
        });
    };

    if (inputs.showDivergences) {
        inputs.divergences.forEach((divergence, position) => addDivergence(`divergence-${position}`, divergence));
    }
    if (inputs.signal?.hasRsiDivergence && inputs.signal.divergence) {
        addDivergence('signal-divergence', inputs.signal.divergence);
    }

    if (inputs.showWickLevels) {
        for (const level of inputs.wickLevels) {
            const color = WICK_COLORS[level.type];
            const x = timeX(level.time);
            const y = priceY(level.midpoint);
            if (x === null || y === null) continue;
            const id = `wick-${level.type}-${level.time}`;
            if (level.status === 'OPEN') {
                model.lines.push({ id, x1: Math.max(0, x), y1: y, x2: plotWidth, y2: y, color, width: 1.5, dash: '6 4' });
                model.texts.push({
                    id: `${id}-label`,
                    x: Math.max(4, plotWidth - 132),
                    y: level.type === 'BULLISH' ? y + 12 : y - 4,
                    text: `50% wick · ${formatPrice(level.midpoint)}`,
                    color,
                    size: 10,
                    weight: 700,
                });
                continue;
            }
            const fillX = level.filledAt === undefined ? null : timeX(level.filledAt);
            if (fillX === null) continue;
            model.lines.push({ id, x1: x, y1: y, x2: fillX, y2: y, color, width: 1, dash: '2 3', opacity: 0.6 });
            model.circles.push({ id: `${id}-fill`, x: fillX, y, radius: 3, fill: color });
        }
    }

    const addFib = (id: string, start: DrawingPoint, end: DrawingPoint, label: string, selected = false) => {
        const startX = timeX(start.time);
        const endX = timeX(end.time);
        if (startX === null || endX === null) return;
        const left = Math.max(0, Math.min(startX, endX));
        const right = Math.max(left + 24, plotWidth);
        const delta = end.price - start.price;

        for (const level of FIB_LEVELS) {
            const price = end.price - (delta * level);
            const y = priceY(price);
            if (y === null) continue;
            model.lines.push({
                id: `${id}-${level}-line`,
                x1: left,
                y1: y,
                x2: right,
                y2: y,
                color: selected ? '#ffffff' : '#f59e0b',
                width: selected ? 2 : 1,
                opacity: level === 0.5 || level === 0.618 ? 0.9 : 0.5,
            });
            model.texts.push({
                id: `${id}-${level}-label`,
                x: left + 5,
                y: y - 3,
                text: `${label} ${(level * 100).toFixed(1)}% · ${formatPrice(price)}`,
                color: selected ? '#ffffff' : '#fbbf24',
                size: 10,
            });
        }
    };

    const addPosition = (id: string, levels: PositionLevels, state: { active?: boolean; ghost?: boolean }) => {
        const geometry = positionGeometry(levels, (time) => anchoredTimeX(chart, inputs.timeAnchor, time), priceY);
        if (!geometry) return;
        const { left, right, entryY, stopY, targetY } = geometry;
        const opacity = state.ghost ? 0.55 : undefined;
        const boxWidth = right - left;
        const clampLabelY = (y: number) => Math.max(10, Math.min(y, mainPaneHeight - 10));

        model.rects.push(
            {
                id: `${id}-reward`,
                x: left,
                y: Math.min(entryY, targetY),
                width: boxWidth,
                height: Math.abs(targetY - entryY),
                fill: state.active ? POSITION_COLORS.rewardActive : POSITION_COLORS.reward,
                opacity,
            },
            {
                id: `${id}-risk`,
                x: left,
                y: Math.min(entryY, stopY),
                width: boxWidth,
                height: Math.abs(stopY - entryY),
                fill: state.active ? POSITION_COLORS.riskActive : POSITION_COLORS.risk,
                opacity,
            }
        );

        // Replay the trade: shade how far price got and trace entry → exit (or → last close).
        const outcome = state.ghost ? null : evaluatePosition(levels, inputs.candles);
        if (outcome && outcome.state !== 'waiting') {
            const fillX = anchoredTimeX(chart, inputs.timeAnchor, outcome.fillTime);
            const exitTime = outcome.state === 'open' ? outcome.lastTime : outcome.exitTime;
            const exitPrice = outcome.state === 'open' ? outcome.lastPrice : outcome.exitPrice;
            const exitX = anchoredTimeX(chart, inputs.timeAnchor, exitTime);
            const exitY = priceY(exitPrice);
            if (fillX !== null && exitX !== null && exitY !== null) {
                const color = outcome.r >= 0 ? POSITION_COLORS.target : POSITION_COLORS.stop;
                model.rects.push({
                    id: `${id}-progress`,
                    x: fillX,
                    y: Math.min(entryY, exitY),
                    width: Math.max(1, exitX - fillX),
                    height: Math.abs(exitY - entryY),
                    fill: color,
                    opacity: 0.16,
                });
                model.lines.push({ id: `${id}-path`, x1: fillX, y1: entryY, x2: exitX, y2: exitY, color: POSITION_COLORS.entry, width: 1, dash: '3 3', opacity: 0.85 });
                model.circles.push({ id: `${id}-exit`, x: exitX, y: exitY, radius: 3.5, fill: color, stroke: '#131722' });
            }
        }

        model.lines.push(
            { id: `${id}-target-edge`, x1: left, y1: targetY, x2: right, y2: targetY, color: POSITION_COLORS.target, width: 1, opacity },
            { id: `${id}-stop-edge`, x1: left, y1: stopY, x2: right, y2: stopY, color: POSITION_COLORS.stop, width: 1, opacity },
            { id: `${id}-entry-line`, x1: left, y1: entryY, x2: right, y2: entryY, color: POSITION_COLORS.entry, width: state.active ? 1.5 : 1, opacity }
        );

        const rr = riskRewardRatio(levels);
        const { equity, riskPercent } = inputs.positionRisk;
        const sizing = calculatePositionSize({ equity, riskPercent, leverage: 1, entryPrice: levels.entry, stopLoss: levels.stop });
        const percentFromEntry = (price: number) => ((price - levels.entry) / levels.entry) * 100;
        const labelX = Math.max(80, Math.min((left + right) / 2, plotWidth - 80));
        const targetAbove = targetY < stopY;
        const status = !outcome || outcome.state === 'waiting'
            ? null
            : outcome.state === 'target'
                ? { text: 'Target hit', background: POSITION_COLORS.targetLabel }
                : outcome.state === 'stop'
                    ? { text: 'Stopped', background: POSITION_COLORS.stopLabel }
                    : { text: `Open ${formatR(outcome.r)}`, background: outcome.r >= 0 ? POSITION_COLORS.targetLabel : POSITION_COLORS.stopLabel };
        const sideLabel = levels.side === 'long' ? 'LONG' : 'SHORT';
        const centerText = state.ghost
            ? `Click to place ${sideLabel} · R:R ${rr.toFixed(2)}`
            : `${sideLabel} · R:R ${rr.toFixed(2)}${status ? ` · ${status.text}` : ''}`;
        const centerWidth = estimateLabelWidth(centerText, 11);
        // Inside the box when it fits between the handles, else beside it so the handles stay clear.
        const centerX = centerWidth <= boxWidth - 28
            ? (left + right) / 2
            : right + 12 + centerWidth <= plotWidth
                ? right + 12 + (centerWidth / 2)
                : left - 12 - centerWidth >= 0
                    ? left - 12 - (centerWidth / 2)
                    : (left + right) / 2;

        model.texts.push(
            {
                id: `${id}-target-label`,
                x: labelX,
                y: clampLabelY(targetAbove ? targetY - 12 : targetY + 12),
                text: `Target ${formatPrice(levels.target)} (${formatSignedPercent(percentFromEntry(levels.target))}) · +${formatUsd(sizing.riskAmount * rr)}`,
                color: '#ffffff',
                background: POSITION_COLORS.targetLabel,
                size: 10,
                weight: 600,
                opacity,
            },
            {
                id: `${id}-stop-label`,
                x: labelX,
                y: clampLabelY(targetAbove ? stopY + 12 : stopY - 12),
                text: `Stop ${formatPrice(levels.stop)} (${formatSignedPercent(percentFromEntry(levels.stop))}) · −${formatUsd(sizing.riskAmount)} · Qty ${formatQuantity(sizing.positionSize)}`,
                color: '#ffffff',
                background: POSITION_COLORS.stopLabel,
                size: 10,
                weight: 600,
                opacity,
            },
            {
                id: `${id}-center-label`,
                x: centerX,
                y: entryY,
                text: centerText,
                color: '#ffffff',
                background: status?.background ?? 'rgba(42, 46, 57, 0.95)',
                size: 11,
                weight: 700,
                opacity,
            }
        );

        if (state.active && !state.ghost) {
            const handle = (part: string, x: number, y: number, stroke: string) => model.circles.push({
                id: `${id}-${part}-handle`, x, y, radius: 5, fill: '#131722', stroke, strokeWidth: 2,
            });
            handle('target', left, targetY, POSITION_COLORS.target);
            handle('stop', left, stopY, POSITION_COLORS.stop);
            handle('entry', left, entryY, POSITION_COLORS.entry);
            handle('width', right, entryY, CHART_ACCENT);
        }
    };

    if (inputs.drawingsVisible) for (const drawing of inputs.drawings) {
        const selected = drawing.id === inputs.selectedDrawingId;
        const position = positionOf(drawing);
        if (position) {
            addPosition(drawing.id, position, { active: selected || drawing.id === inputs.hoveredDrawingId });
            continue;
        }
        const startX = timeX(drawing.start.time);
        const startY = priceY(drawing.start.price);
        if (startX === null || startY === null) continue;
        if (drawing.type === 'horizontal') {
            model.lines.push({ id: drawing.id, x1: 0, y1: startY, x2: plotWidth, y2: startY, color: selected ? '#ffffff' : '#38bdf8', width: selected ? 2.5 : 1.5, dash: '6 4' });
            if (selected) model.circles.push({ id: `${drawing.id}-handle`, x: Math.min(plotWidth - 12, plotWidth * 0.72), y: startY, radius: 5, fill: '#38bdf8', stroke: '#fff' });
            continue;
        }
        if (!drawing.end) continue;
        if (drawing.type === 'fibonacci') {
            addFib(drawing.id, drawing.start, drawing.end, 'Fib', selected);
            if (selected) {
                const endX = timeX(drawing.end.time);
                const endY = priceY(drawing.end.price);
                model.circles.push({ id: `${drawing.id}-start-handle`, x: startX, y: startY, radius: 5, fill: '#f59e0b', stroke: '#fff' });
                if (endX !== null && endY !== null) model.circles.push({ id: `${drawing.id}-end-handle`, x: endX, y: endY, radius: 5, fill: '#f59e0b', stroke: '#fff' });
            }
            continue;
        }
        const endX = timeX(drawing.end.time);
        const endY = priceY(drawing.end.price);
        if (endX === null || endY === null) continue;
        model.lines.push({ id: drawing.id, x1: startX, y1: startY, x2: endX, y2: endY, color: selected ? '#ffffff' : '#38bdf8', width: selected ? 3 : 2 });
        if (selected) {
            model.circles.push(
                { id: `${drawing.id}-start-handle`, x: startX, y: startY, radius: 5, fill: '#38bdf8', stroke: '#fff' },
                { id: `${drawing.id}-end-handle`, x: endX, y: endY, radius: 5, fill: '#38bdf8', stroke: '#fff' }
            );
        }
    }

    if (inputs.showAutoFib && inputs.autoFib) {
        addFib('auto-fib', inputs.autoFib.start, inputs.autoFib.end, 'Auto Fib');
    }

    if (inputs.positionPreview) {
        addPosition('position-preview', inputs.positionPreview, { ghost: true });
    }

    if (inputs.draftAnchor) {
        const x = timeX(inputs.draftAnchor.time);
        const y = priceY(inputs.draftAnchor.price);
        if (x !== null && y !== null) {
            model.circles.push({ id: 'draft-anchor', x, y, radius: 5, fill: '#38bdf8', stroke: '#fff' });
        }
    }

    return model;
}

export default function Chart({
    candles,
    zones = [],
    isLoading,
    showRsi,
    showBollinger,
    onToggleRsi,
    onToggleBollinger,
}: ChartProps) {
    const showZones = useTradingStore((state) => state.showZones);
    const toggleZones = useTradingStore((state) => state.toggleZones);
    const plottedSignal = useTradingStore((state) => state.plottedSignal);
    const selectedCoin = useTradingStore((state) => state.selectedCoin);
    const selectedTimeframe = useTradingStore((state) => state.selectedTimeframe);
    const accountEquity = useTradingStore((state) => state.settings.accountEquity);
    const riskPercent = useTradingStore((state) => state.settings.riskPercent);
    const stepMs = getTimeframeMs(selectedTimeframe);
    const containerRef = useRef<HTMLDivElement>(null);
    const plotAreaRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const ema20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const ema50SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const bollingerUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const bollingerMiddleSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const bollingerLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const rsiPaneRef = useRef<IPaneApi<Time> | null>(null);
    const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const rsiBullDivergenceSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const rsiBearDivergenceSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const engulfingMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const rsiStateRef = useRef<RsiIncrementalState | null>(null);
    const ema20Ref = useRef<EmaCursor>(createEmaCursor());
    const ema50Ref = useRef<EmaCursor>(createEmaCursor());
    const previousCandlesRef = useRef<Candle[]>([]);
    const overlayFrameRef = useRef<number | null>(null);
    const overlayHandleRef = useRef<OverlayHandle>(null);
    const signalPriceLinesRef = useRef<IPriceLine[]>([]);
    const drawingsHydratedRef = useRef(false);
    const overlayInputsRef = useRef<OverlayInputs>({
        zones: [],
        supersededZoneIds: new Set(),
        showZones: false,
        signal: null,
        drawings: [],
        showAutoFib: false,
        autoFib: null,
        draftAnchor: null,
        selectedDrawingId: null,
        drawingsVisible: true,
        divergences: [],
        showDivergences: true,
        wickLevels: [],
        showWickLevels: true,
        candles: [],
        timeAnchor: null,
        positionRisk: { equity: 0, riskPercent: 0 },
    });
    const liveRef = useRef<LiveInteraction>({ drawing: null, hoverId: null, preview: null });
    const storageKey = `chain-trader-drawings:${selectedCoin}:${selectedTimeframe}`;
    const [drawingMode, setDrawingMode] = useState<DrawingMode>('cursor');
    const [drawings, setDrawings] = useState<Drawing[]>([]);
    const [redoStack, setRedoStack] = useState<Drawing[]>([]);
    const [draftAnchor, setDraftAnchor] = useState<DrawingPoint | null>(null);
    const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
    const [drawingsVisible, setDrawingsVisible] = useState(true);
    const [showAutoFib, setShowAutoFib] = useState(false);
    const [showEngulfing, setShowEngulfing] = useState(true);
    const [showDivergences, setShowDivergences] = useState(true);
    const [showWickLevels, setShowWickLevels] = useState(true);
    const [showVolume, setShowVolume] = useState(true);
    const [showEma20, setShowEma20] = useState(false);
    const [showEma50, setShowEma50] = useState(false);
    const [magnetEnabled, setMagnetEnabled] = useState(false);
    const [keepDrawing, setKeepDrawing] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [hoverCandle, setHoverCandle] = useState<Candle | null>(null);
    const [toolMessage, setToolMessage] = useState('Cursor active — drag to pan, scroll to zoom.');
    const drawingModeRef = useRef<DrawingMode>('cursor');
    const draftAnchorRef = useRef<DrawingPoint | null>(null);
    const drawingsRef = useRef<Drawing[]>([]);
    const dragRef = useRef<DragState | null>(null);
    const candlesRef = useRef(candles);
    const magnetEnabledRef = useRef(false);
    const keepDrawingRef = useRef(false);
    const hoverCandleTimeRef = useRef<number | null>(null);

    const signalToPlot = plottedSignal?.coin === selectedCoin && plottedSignal.timeframe === selectedTimeframe
        ? plottedSignal
        : null;
    const latestCandle = candles[candles.length - 1];
    const currentPrice = latestCandle?.close || 0;
    const firstCandleTime = candles[0]?.time ?? null;
    const latestCandleTime = latestCandle?.time ?? null;
    const timeAnchor = useMemo<TimeAnchor | null>(
        () => latestCandleTime === null ? null : { time: latestCandleTime, index: candles.length - 1, stepMs },
        [candles.length, latestCandleTime, stepMs]
    );
    const chartZones = useMemo(() => getChartZones(zones), [zones]);
    const supersededZoneIds = useMemo(() => findSupersededZoneIds(chartZones), [chartZones]);
    const autoFib = useMemo(() => getAutoFibAnchors(candles), [candles]);
    // Decisive engulfing structures from closed candles. Per the Chain Strategy
    // PDF the zone is the candle that got swallowed — the last red candle
    // before a bullish engulfing, the last green candle before a bearish one —
    // so that is the candle that gets the marker.
    const engulfingMarkers = useMemo<SeriesMarker<Time>[]>(() => {
        const closed = candles.slice(0, -1);
        return detectEngulfingPatterns(closed).filter((pattern) => isDecisiveEngulfing(closed, pattern)).map((pattern) => pattern.type === 'BULLISH'
            ? { time: (pattern.engulfedCandle.time / 1000) as Time, position: 'belowBar', shape: 'arrowUp', color: '#00d26a', text: 'E' }
            : { time: (pattern.engulfedCandle.time / 1000) as Time, position: 'aboveBar', shape: 'arrowDown', color: '#ff4757', text: 'E' });
    }, [candles]);
    const tripleDivergences = useMemo(
        () => findTripleDivergences(candles, calculateRSI(candles.map((candle) => candle.close))).slice(-MAX_DIVERGENCES_SHOWN),
        [candles]
    );
    const wickMidpoints = useMemo(() => findWickMidpoints(candles), [candles]);
    const wickRecord = useMemo(() => summarizeWickMidpoints(wickMidpoints), [wickMidpoints]);
    const shownWickLevels = useMemo(() => [
        ...wickMidpoints
            .filter((level) => level.status === 'OPEN')
            .sort((first, second) => Math.abs(first.midpoint - currentPrice) - Math.abs(second.midpoint - currentPrice))
            .slice(0, MAX_OPEN_WICKS_SHOWN),
        ...wickMidpoints.filter((level) => level.status === 'FILLED').slice(-MAX_FILLED_WICKS_SHOWN),
    ], [currentPrice, wickMidpoints]);
    const displayCandle = hoverCandle || latestCandle;
    const candleChange = displayCandle
        ? displayCandle.open === 0 ? 0 : ((displayCandle.close - displayCandle.open) / displayCandle.open) * 100
        : 0;

    useEffect(() => {
        candlesRef.current = candles;
    }, [candles]);

    useEffect(() => {
        drawingsRef.current = drawings;
    }, [drawings]);

    useEffect(() => {
        magnetEnabledRef.current = magnetEnabled;
    }, [magnetEnabled]);

    useEffect(() => {
        keepDrawingRef.current = keepDrawing;
    }, [keepDrawing]);

    useEffect(() => {
        if (!isFullscreen) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [isFullscreen]);

    const scheduleOverlay = useCallback(() => {
        if (overlayFrameRef.current !== null) return;
        overlayFrameRef.current = requestAnimationFrame(() => {
            overlayFrameRef.current = null;
            const chart = chartRef.current;
            const series = seriesRef.current;
            const container = containerRef.current;
            if (!chart || !series || !container) return;
            const inputs = overlayInputsRef.current;
            const live = liveRef.current;
            const liveDrawing = live.drawing;
            overlayHandleRef.current?.setModel(buildOverlayModel(
                chart,
                series,
                container.clientWidth,
                container.clientHeight,
                {
                    ...inputs,
                    drawings: liveDrawing
                        ? inputs.drawings.map((drawing) => drawing.id === liveDrawing.id ? liveDrawing : drawing)
                        : inputs.drawings,
                    hoveredDrawingId: live.hoverId,
                    positionPreview: live.preview,
                }
            ));
        });
    }, []);

    /** A default-sized position anchored at plot coordinates (x, y), snapped to the nearest bar. */
    const positionPlacement = useCallback((side: PositionSide, x: number, y: number): PositionLevels | null => {
        const chart = chartRef.current;
        const series = seriesRef.current;
        const loaded = candlesRef.current;
        const last = loaded[loaded.length - 1];
        if (!chart || !series || !last || y < 0 || y > series.getPane().getHeight()) return null;
        const logical = chart.timeScale().coordinateToLogical(x);
        const cursorPrice = series.coordinateToPrice(y);
        if (logical === null || cursorPrice === null) return null;
        const barIndex = Math.round(logical);
        let price = Number(cursorPrice);
        const bar = loaded[barIndex];
        if (magnetEnabledRef.current && bar) {
            price = [bar.open, bar.high, bar.low, bar.close]
                .reduce((nearest, candidate) => Math.abs(candidate - price) < Math.abs(nearest - price) ? candidate : nearest);
        }
        if (!(price > 0)) return null;
        const time = logicalToTime({ time: last.time, index: loaded.length - 1, stepMs }, barIndex);
        // About a fifth of the visible bars, so the box reads at any zoom level.
        const visible = chart.timeScale().getVisibleLogicalRange();
        const bars = visible ? Math.min(200, Math.max(10, Math.round((visible.to - visible.from) * 0.2))) : undefined;
        return createDefaultPosition(side, loaded, time, price, stepMs, bars);
    }, [stepMs]);

    useEffect(() => {
        let secondFrame: number | null = null;
        const firstFrame = requestAnimationFrame(() => {
            secondFrame = requestAnimationFrame(() => {
                const chart = chartRef.current;
                const container = containerRef.current;
                if (!chart || !container) return;
                chart.resize(container.clientWidth, container.clientHeight);
                scheduleOverlay();
            });
        });
        return () => {
            cancelAnimationFrame(firstFrame);
            if (secondFrame !== null) cancelAnimationFrame(secondFrame);
        };
    }, [isFullscreen, scheduleOverlay]);

    useEffect(() => {
        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            let storedDrawings: Drawing[] = [];
            try {
                const raw = localStorage.getItem(storageKey);
                const stored: unknown = raw ? JSON.parse(raw) : [];
                storedDrawings = Array.isArray(stored) ? stored.filter(isStoredDrawing) : [];
            } catch {
                storedDrawings = [];
            }
            drawingsHydratedRef.current = true;
            setDrawings(storedDrawings);
        });
        return () => {
            cancelled = true;
        };
    }, [storageKey]);

    useEffect(() => {
        if (!drawingsHydratedRef.current) return;
        try {
            localStorage.setItem(storageKey, JSON.stringify(drawings));
        } catch {
            // Drawing persistence is optional; the live chart remains usable.
        }
    }, [drawings, storageKey]);

    useEffect(() => {
        if (!containerRef.current) return;

        const chart = createChart(containerRef.current, {
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
            layout: {
                background: { color: '#141414' },
                textColor: '#d4d4d8',
                panes: {
                    enableResize: true,
                    separatorColor: '#2a2e39',
                    separatorHoverColor: 'rgba(77, 141, 255, 0.18)',
                },
            },
            grid: {
                vertLines: { color: '#232323' },
                horzLines: { color: '#232323' },
            },
            crosshair: {
                mode: 1,
                vertLine: { color: CHART_ACCENT, width: 1, style: 2, labelBackgroundColor: CHART_ACCENT },
                horzLine: { color: CHART_ACCENT, width: 1, style: 2, labelBackgroundColor: CHART_ACCENT },
            },
            rightPriceScale: {
                borderColor: '#2a2a2a',
                scaleMargins: { top: 0.08, bottom: 0.1 },
            },
            timeScale: {
                borderColor: '#2a2a2a',
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 8,
                barSpacing: 8,
            },
            handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
            handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
        });
        const series = chart.addSeries(CandlestickSeries, {
            upColor: '#00d26a',
            downColor: '#ff4757',
            borderUpColor: '#00d26a',
            borderDownColor: '#ff4757',
            wickUpColor: '#00d26a',
            wickDownColor: '#ff4757',
            priceLineVisible: true,
            lastValueVisible: true,
        });
        const volumeSeries = chart.addSeries(HistogramSeries, {
            priceScaleId: 'volume',
            priceFormat: { type: 'volume' },
            lastValueVisible: false,
            priceLineVisible: false,
            visible: true,
        });
        const ema20Series = chart.addSeries(LineSeries, {
            color: CHART_ACCENT,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            visible: false,
        });
        const ema50Series = chart.addSeries(LineSeries, {
            color: '#f59e0b',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            visible: false,
        });
        const bollingerUpperSeries = chart.addSeries(LineSeries, {
            color: 'rgba(139, 152, 178, 0.72)',
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            visible: false,
        });
        const bollingerMiddleSeries = chart.addSeries(LineSeries, {
            color: 'rgba(139, 152, 178, 0.58)',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            visible: false,
        });
        const bollingerLowerSeries = chart.addSeries(LineSeries, {
            color: 'rgba(139, 152, 178, 0.72)',
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            visible: false,
        });
        chart.priceScale('volume').applyOptions({
            scaleMargins: { top: 0.82, bottom: 0 },
        });
        engulfingMarkersRef.current = createSeriesMarkers(series, []);

        chartRef.current = chart;
        seriesRef.current = series;
        volumeSeriesRef.current = volumeSeries;
        ema20SeriesRef.current = ema20Series;
        ema50SeriesRef.current = ema50Series;
        bollingerUpperSeriesRef.current = bollingerUpperSeries;
        bollingerMiddleSeriesRef.current = bollingerMiddleSeries;
        bollingerLowerSeriesRef.current = bollingerLowerSeries;
        const resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            chart.resize(Math.floor(entry.contentRect.width), Math.floor(entry.contentRect.height));
            scheduleOverlay();
        });
        resizeObserver.observe(containerRef.current);
        const mainPaneResizeObserver = new ResizeObserver(scheduleOverlay);
        let observePaneFrame: number | null = null;
        const observeMainPane = () => {
            const paneElement = series.getPane().getHTMLElement();
            if (paneElement) {
                mainPaneResizeObserver.observe(paneElement);
            } else {
                observePaneFrame = requestAnimationFrame(observeMainPane);
            }
        };
        observeMainPane();
        const handleCrosshairMove = (param: MouseEventParams<Time>) => {
            const time = typeof param.time === 'number' ? param.time * 1000 : null;
            if (time === hoverCandleTimeRef.current) return;
            hoverCandleTimeRef.current = time;
            setHoverCandle(time === null ? null : candlesRef.current.find((candle) => candle.time === time) || null);
        };
        chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleOverlay);
        chart.subscribeCrosshairMove(handleCrosshairMove);

        return () => {
            resizeObserver.disconnect();
            mainPaneResizeObserver.disconnect();
            if (observePaneFrame !== null) cancelAnimationFrame(observePaneFrame);
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleOverlay);
            chart.unsubscribeCrosshairMove(handleCrosshairMove);
            if (overlayFrameRef.current !== null) cancelAnimationFrame(overlayFrameRef.current);
            // Clear it too, or a remounted chart (React dev double-mount) never redraws the overlay.
            overlayFrameRef.current = null;
            signalPriceLinesRef.current.forEach((line) => series.removePriceLine(line));
            signalPriceLinesRef.current = [];
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
            volumeSeriesRef.current = null;
            ema20SeriesRef.current = null;
            ema50SeriesRef.current = null;
            bollingerUpperSeriesRef.current = null;
            bollingerMiddleSeriesRef.current = null;
            bollingerLowerSeriesRef.current = null;
            rsiPaneRef.current = null;
            rsiSeriesRef.current = null;
            rsiBullDivergenceSeriesRef.current = null;
            rsiBearDivergenceSeriesRef.current = null;
            engulfingMarkersRef.current = null;
            rsiStateRef.current = null;
            // The next chart starts with empty series. Without this, a remount on the same instance
            // (StrictMode, Fast Refresh) sees unchanged candles and paints only the last bar.
            previousCandlesRef.current = [];
        };
    }, [scheduleOverlay]);

    useEffect(() => {
        engulfingMarkersRef.current?.setMarkers(showEngulfing ? engulfingMarkers : []);
    }, [engulfingMarkers, showEngulfing]);

    useEffect(() => {
        volumeSeriesRef.current?.applyOptions({ visible: showVolume });
        const ema20Series = ema20SeriesRef.current;
        const ema50Series = ema50SeriesRef.current;
        ema20Series?.applyOptions({ visible: showEma20 });
        ema50Series?.applyOptions({ visible: showEma50 });

        if (showEma20 && ema20Series) {
            const ema20Data = calculateEma(candlesRef.current, 20);
            ema20Series.setData(ema20Data);
            seedEmaCursor(ema20Ref.current, candlesRef.current, ema20Data);
        }
        if (showEma50 && ema50Series) {
            const ema50Data = calculateEma(candlesRef.current, 50);
            ema50Series.setData(ema50Data);
            seedEmaCursor(ema50Ref.current, candlesRef.current, ema50Data);
        }
    }, [showEma20, showEma50, showVolume]);

    useEffect(() => {
        const upperSeries = bollingerUpperSeriesRef.current;
        const middleSeries = bollingerMiddleSeriesRef.current;
        const lowerSeries = bollingerLowerSeriesRef.current;
        if (!upperSeries || !middleSeries || !lowerSeries) return;

        upperSeries.applyOptions({ visible: showBollinger });
        middleSeries.applyOptions({ visible: showBollinger });
        lowerSeries.applyOptions({ visible: showBollinger });
        if (!showBollinger) return;

        const bands = calculateBollingerBands(candlesRef.current);
        upperSeries.setData(bands.map((point) => ({
            time: (point.time / 1000) as Time,
            value: point.upper,
        })));
        middleSeries.setData(bands.map((point) => ({
            time: (point.time / 1000) as Time,
            value: point.middle,
        })));
        lowerSeries.setData(bands.map((point) => ({
            time: (point.time / 1000) as Time,
            value: point.lower,
        })));
    }, [showBollinger]);

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart || !showRsi) return;

        const pane = chart.addPane(true);
        chart.panes()[0]?.setStretchFactor(3);
        pane.setStretchFactor(1);

        const rsiSeries = pane.addSeries(LineSeries, {
            title: 'RSI 14',
            color: '#8b5cf6',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            crosshairMarkerVisible: true,
            priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
            autoscaleInfoProvider: () => ({
                priceRange: { minValue: 0, maxValue: 100 },
            }),
        });
        rsiSeries.createPriceLine({
            price: 70,
            color: 'rgba(148, 163, 184, 0.55)',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: '70',
        });
        rsiSeries.createPriceLine({
            price: 30,
            color: 'rgba(148, 163, 184, 0.55)',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: '30',
        });
        const divergenceSeriesOptions = {
            lineWidth: 2,
            lineStyle: LineStyle.Dotted,
            pointMarkersVisible: true,
            pointMarkersRadius: 4,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        } as const;
        const rsiBullDivergenceSeries = pane.addSeries(LineSeries, { ...divergenceSeriesOptions, color: DIVERGENCE_COLORS.BULLISH });
        const rsiBearDivergenceSeries = pane.addSeries(LineSeries, { ...divergenceSeriesOptions, color: DIVERGENCE_COLORS.BEARISH });

        pane.priceScale('right').applyOptions({
            autoScale: true,
            borderColor: '#2a2e39',
            scaleMargins: { top: 0.06, bottom: 0.06 },
        });

        const seeded = calculateRsiSeries(candlesRef.current);
        rsiSeries.setData(seeded.points.map((point) => ({
            time: (point.time / 1000) as Time,
            value: point.value,
        })));
        rsiStateRef.current = seeded.state;
        rsiPaneRef.current = pane;
        rsiSeriesRef.current = rsiSeries;
        rsiBullDivergenceSeriesRef.current = rsiBullDivergenceSeries;
        rsiBearDivergenceSeriesRef.current = rsiBearDivergenceSeries;
        scheduleOverlay();

        return () => {
            if (chartRef.current === chart) {
                const paneIndex = pane.paneIndex();
                chart.removeSeries(rsiBearDivergenceSeries);
                chart.removeSeries(rsiBullDivergenceSeries);
                chart.removeSeries(rsiSeries);
                chart.removePane(paneIndex);
                scheduleOverlay();
            }
            rsiPaneRef.current = null;
            rsiSeriesRef.current = null;
            rsiBullDivergenceSeriesRef.current = null;
            rsiBearDivergenceSeriesRef.current = null;
            rsiStateRef.current = null;
        };
    }, [scheduleOverlay, showRsi]);

    useEffect(() => {
        const bullSeries = rsiBullDivergenceSeriesRef.current;
        const bearSeries = rsiBearDivergenceSeriesRef.current;
        if (!showRsi || !bullSeries || !bearSeries) return;

        const shown = showDivergences ? [...tripleDivergences] : [];
        const signalDivergence = signalToPlot?.hasRsiDivergence ? signalToPlot.divergence : undefined;
        if (signalDivergence && !shown.some((divergence) =>
            divergence.type === signalDivergence.type && divergence.pricePoint2.time === signalDivergence.pricePoint2.time
        )) {
            shown.push(signalDivergence);
        }
        bullSeries.setData(buildRsiDivergenceData(candlesRef.current, shown.filter((divergence) => divergence.type === 'BULLISH')));
        bearSeries.setData(buildRsiDivergenceData(candlesRef.current, shown.filter((divergence) => divergence.type === 'BEARISH')));
    }, [firstCandleTime, showDivergences, showRsi, signalToPlot, tripleDivergences]);

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        const canPan = drawingMode === 'cursor';
        chart.applyOptions({
            handleScroll: {
                mouseWheel: true,
                pressedMouseMove: canPan,
                horzTouchDrag: canPan,
                vertTouchDrag: canPan,
            },
            handleScale: { axisPressedMouseMove: canPan, mouseWheel: true, pinch: true },
        });
    }, [drawingMode]);

    useEffect(() => {
        const series = seriesRef.current;
        const volumeSeries = volumeSeriesRef.current;
        const ema20Series = ema20SeriesRef.current;
        const ema50Series = ema50SeriesRef.current;
        const chart = chartRef.current;
        if (!series || !volumeSeries || !ema20Series || !ema50Series || !chart || candles.length === 0) return;

        const latest = candles[candles.length - 1];
        const latestData: CandlestickData<Time> = {
            time: (latest.time / 1000) as Time,
            open: latest.open,
            high: latest.high,
            low: latest.low,
            close: latest.close,
        };
        const latestVolume = {
            time: (latest.time / 1000) as Time,
            value: latest.volume,
            color: latest.close >= latest.open ? 'rgba(38, 166, 154, 0.45)' : 'rgba(239, 83, 80, 0.45)',
        };
        const canIncrementallyUpdate = canUpdateLastCandle(previousCandlesRef.current, candles);

        if (canIncrementallyUpdate) {
            series.update(latestData);
            volumeSeries.update(latestVolume);
            if (showEma20) ema20Series.update(advanceEmaCursor(ema20Ref.current, latest, 20));
            if (showEma50) ema50Series.update(advanceEmaCursor(ema50Ref.current, latest, 50));
            if (showRsi && rsiSeriesRef.current && rsiStateRef.current) {
                const rsiUpdate = updateRsiLastPoint(rsiStateRef.current, latest);
                rsiStateRef.current = rsiUpdate.state;
                if (rsiUpdate.point) {
                    rsiSeriesRef.current.update({
                        time: (rsiUpdate.point.time / 1000) as Time,
                        value: rsiUpdate.point.value,
                    });
                }
            }
            if (
                showBollinger &&
                bollingerUpperSeriesRef.current &&
                bollingerMiddleSeriesRef.current &&
                bollingerLowerSeriesRef.current
            ) {
                const band = calculateBollingerLastPoint(candles);
                if (band) {
                    const time = (band.time / 1000) as Time;
                    bollingerUpperSeriesRef.current.update({ time, value: band.upper });
                    bollingerMiddleSeriesRef.current.update({ time, value: band.middle });
                    bollingerLowerSeriesRef.current.update({ time, value: band.lower });
                }
            }
        } else {
            series.setData(candles.map((candle) => ({
                time: (candle.time / 1000) as Time,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
            })));
            volumeSeries.setData(candles.map((candle) => ({
                time: (candle.time / 1000) as Time,
                value: candle.volume,
                color: candle.close >= candle.open ? 'rgba(38, 166, 154, 0.45)' : 'rgba(239, 83, 80, 0.45)',
            })));
            if (showEma20) {
                const ema20Data = calculateEma(candles, 20);
                ema20Series.setData(ema20Data);
                seedEmaCursor(ema20Ref.current, candles, ema20Data);
            }
            if (showEma50) {
                const ema50Data = calculateEma(candles, 50);
                ema50Series.setData(ema50Data);
                seedEmaCursor(ema50Ref.current, candles, ema50Data);
            }
            if (showRsi && rsiSeriesRef.current) {
                const rsi = calculateRsiSeries(candles);
                rsiSeriesRef.current.setData(rsi.points.map((point) => ({
                    time: (point.time / 1000) as Time,
                    value: point.value,
                })));
                rsiStateRef.current = rsi.state;
            }
            if (
                showBollinger &&
                bollingerUpperSeriesRef.current &&
                bollingerMiddleSeriesRef.current &&
                bollingerLowerSeriesRef.current
            ) {
                const bands = calculateBollingerBands(candles);
                bollingerUpperSeriesRef.current.setData(bands.map((point) => ({
                    time: (point.time / 1000) as Time,
                    value: point.upper,
                })));
                bollingerMiddleSeriesRef.current.setData(bands.map((point) => ({
                    time: (point.time / 1000) as Time,
                    value: point.middle,
                })));
                bollingerLowerSeriesRef.current.setData(bands.map((point) => ({
                    time: (point.time / 1000) as Time,
                    value: point.lower,
                })));
            }
            if (shouldFitAfterRebuild(previousCandlesRef.current, candles)) chart.timeScale().fitContent();
        }

        previousCandlesRef.current = candles;
        scheduleOverlay();
    }, [candles, scheduleOverlay, showBollinger, showEma20, showEma50, showRsi]);

    useEffect(() => {
        const chart = chartRef.current;
        const series = seriesRef.current;
        if (!chart || !series) return;

        signalPriceLinesRef.current.forEach((line) => series.removePriceLine(line));
        signalPriceLinesRef.current = [];

        const autoscaleInfoProvider: AutoscaleInfoProvider = (original) => {
            const result = original();
            if (!result || !signalToPlot) return result;
            const plottedLevels = [
                signalToPlot.entryPrice,
                signalToPlot.stopLoss,
                signalToPlot.takeProfit,
                signalToPlot.originZone.proximalLine,
                signalToPlot.originZone.distalLine,
                signalToPlot.eventZone.proximalLine,
                signalToPlot.eventZone.distalLine,
            ];
            const signalMinimum = Math.min(...plottedLevels);
            const signalMaximum = Math.max(...plottedLevels);

            return {
                ...result,
                priceRange: {
                    minValue: Math.min(result.priceRange?.minValue ?? signalMinimum, signalMinimum),
                    maxValue: Math.max(result.priceRange?.maxValue ?? signalMaximum, signalMaximum),
                },
            };
        };
        series.applyOptions({ autoscaleInfoProvider });

        if (signalToPlot) {
            signalPriceLinesRef.current = [
                series.createPriceLine({
                    price: signalToPlot.entryPrice,
                    color: '#fbbf24',
                    lineWidth: 2,
                    lineStyle: LineStyle.Solid,
                    axisLabelVisible: true,
                    title: 'ENTRY',
                }),
                series.createPriceLine({
                    price: signalToPlot.stopLoss,
                    color: '#ff4757',
                    lineWidth: 2,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: 'STOP',
                }),
                series.createPriceLine({
                    price: signalToPlot.takeProfit,
                    color: '#00d26a',
                    lineWidth: 2,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: 'TARGET',
                }),
            ];
        }

        chart.priceScale('right').applyOptions({ autoScale: true });
        scheduleOverlay();
    }, [scheduleOverlay, signalToPlot]);

    useEffect(() => {
        const chart = chartRef.current;
        const series = seriesRef.current;
        if (!chart || !series) return;

        const handleClick = (param: MouseEventParams<Time>) => {
            const activeMode = drawingModeRef.current;
            if (activeMode === 'cursor' || !param.point) return;
            if ((param.paneIndex ?? 0) !== series.getPane().paneIndex()) return;
            if (activeMode === 'long' || activeMode === 'short') {
                const levels = positionPlacement(activeMode, param.point.x, param.point.y);
                if (!levels) return;
                const drawing = positionDrawing(drawingId(), levels);
                liveRef.current.preview = null;
                setDrawings((items) => [...items, drawing]);
                setRedoStack([]);
                setSelectedDrawingId(drawing.id);
                if (!keepDrawingRef.current) {
                    drawingModeRef.current = 'cursor';
                    setDrawingMode('cursor');
                }
                setToolMessage(`${describePosition(levels)}. Drag the green edge for target, red edge for stop, right edge for length, or the box to move it.`);
                return;
            }
            if (param.time === undefined) return;
            const price = series.coordinateToPrice(param.point.y);
            const time = typeof param.time === 'number' ? param.time * 1000 : NaN;
            if (price === null || !Number.isFinite(time)) return;

            let point: DrawingPoint = { time, price: Number(price) };
            if (magnetEnabledRef.current) {
                const nearestCandle = candlesRef.current.reduce<Candle | null>((nearest, candle) => {
                    if (!nearest) return candle;
                    return Math.abs(candle.time - time) < Math.abs(nearest.time - time) ? candle : nearest;
                }, null);
                if (nearestCandle) {
                    const snappedPrice = [nearestCandle.open, nearestCandle.high, nearestCandle.low, nearestCandle.close]
                        .reduce((nearest, candidate) => Math.abs(candidate - price) < Math.abs(nearest - price) ? candidate : nearest);
                    point = { time: nearestCandle.time, price: snappedPrice };
                }
            }
            if (activeMode === 'horizontal') {
                const drawing = { id: drawingId(), type: 'horizontal' as const, start: point };
                setDrawings((items) => [...items, drawing]);
                setRedoStack([]);
                setSelectedDrawingId(drawing.id);
                if (!keepDrawingRef.current) {
                    drawingModeRef.current = 'cursor';
                    setDrawingMode('cursor');
                }
                setToolMessage(`Horizontal line added at ${formatPrice(point.price)}. Drag it to reposition or press Delete to remove.`);
                return;
            }

            const currentAnchor = draftAnchorRef.current;
            if (!currentAnchor) {
                draftAnchorRef.current = point;
                setDraftAnchor(point);
                setToolMessage(`First anchor set at ${formatPrice(price)} — click the chart again to finish.`);
                return;
            }

            const drawing = { id: drawingId(), type: activeMode, start: currentAnchor, end: point } as Drawing;
            setDrawings((items) => [...items, drawing]);
            setRedoStack([]);
            setSelectedDrawingId(drawing.id);
            if (activeMode === 'fibonacci') setShowAutoFib(false);
            draftAnchorRef.current = null;
            setDraftAnchor(null);
            if (!keepDrawingRef.current) {
                drawingModeRef.current = 'cursor';
                setDrawingMode('cursor');
            }
            setToolMessage(`${activeMode === 'trend' ? 'Trend line' : 'Fibonacci retracement'} added. Drag it to reposition or press Delete to remove.`);
        };

        chart.subscribeClick(handleClick);
        return () => chart.unsubscribeClick(handleClick);
    }, [positionPlacement]);

    useEffect(() => {
        overlayInputsRef.current = {
            zones: chartZones,
            supersededZoneIds,
            showZones,
            signal: signalToPlot,
            drawings,
            showAutoFib,
            autoFib,
            draftAnchor,
            selectedDrawingId,
            drawingsVisible,
            divergences: tripleDivergences,
            showDivergences,
            wickLevels: shownWickLevels,
            showWickLevels,
            candles,
            timeAnchor,
            positionRisk: { equity: accountEquity, riskPercent },
        };
        scheduleOverlay();
    }, [accountEquity, candles, riskPercent, timeAnchor, autoFib, draftAnchor, drawings, drawingsVisible, chartZones, supersededZoneIds, selectedDrawingId, showAutoFib, showZones, signalToPlot, scheduleOverlay, tripleDivergences, showDivergences, shownWickLevels, showWickLevels]);

    const setMode = (mode: DrawingMode) => {
        drawingModeRef.current = mode;
        draftAnchorRef.current = null;
        setDrawingMode(mode);
        setDraftAnchor(null);
        if (mode !== 'cursor') setSelectedDrawingId(null);
        liveRef.current.preview = null;
        liveRef.current.hoverId = null;
        scheduleOverlay();
        setToolMessage(
            mode === 'cursor'
                ? 'Cursor active — drag to pan, scroll to zoom.'
                : mode === 'horizontal'
                    ? 'H-Line active — click the chart at the price level you want.'
                    : mode === 'trend'
                        ? 'Trend active — click a start point, then click an end point.'
                        : mode === 'fibonacci'
                            ? 'Fib Draw active — click the swing start, then click the swing end.'
                            : `${mode === 'long' ? 'Long' : 'Short'} position active — click your entry. Stop starts 1.5 average candles away, target at 2R.`
        );
    };

    const zoomChart = (factor: number) => {
        const timeScale = chartRef.current?.timeScale();
        const range = timeScale?.getVisibleLogicalRange();
        if (!timeScale || !range) return;
        const center = (range.from + range.to) / 2;
        const halfRange = ((range.to - range.from) * factor) / 2;
        timeScale.setVisibleLogicalRange({ from: center - halfRange, to: center + halfRange });
        setToolMessage(factor < 1 ? 'Chart zoomed in.' : 'Chart zoomed out.');
    };

    const resetView = () => {
        chartRef.current?.timeScale().fitContent();
        chartRef.current?.priceScale('right').applyOptions({ autoScale: true });
        setToolMessage('Chart view reset to fit all loaded candles.');
    };

    const goToRealtime = () => {
        chartRef.current?.timeScale().scrollToRealTime();
        setToolMessage('Returned to the latest live candle.');
    };

    const toggleMagnet = () => {
        const next = !magnetEnabledRef.current;
        magnetEnabledRef.current = next;
        setMagnetEnabled(next);
        setToolMessage(next ? 'Magnet on — drawing points snap to the nearest OHLC value.' : 'Magnet off — drawing points use the exact cursor price.');
    };

    const toggleKeepDrawing = () => {
        const next = !keepDrawingRef.current;
        keepDrawingRef.current = next;
        setKeepDrawing(next);
        setToolMessage(next ? 'Keep drawing on — the selected tool stays active after completion.' : 'Keep drawing off — the chart returns to Cursor after each drawing.');
    };

    const deleteSelectedDrawing = () => {
        if (!selectedDrawingId) return;
        const selected = drawingsRef.current.find((drawing) => drawing.id === selectedDrawingId);
        if (!selected) return;
        setDrawings((items) => items.filter((drawing) => drawing.id !== selectedDrawingId));
        setRedoStack((items) => [...items, selected]);
        setSelectedDrawingId(null);
        setToolMessage('Selected drawing removed. Use Redo to restore it.');
    };

    const pointFromPointer = (event: React.PointerEvent<HTMLDivElement>): DrawingPoint | null => {
        const chart = chartRef.current;
        const series = seriesRef.current;
        const area = plotAreaRef.current;
        if (!chart || !series || !area) return null;
        const bounds = area.getBoundingClientRect();
        const paneY = event.clientY - bounds.top;
        if (paneY < 0 || paneY > series.getPane().getHeight()) return null;
        const time = chart.timeScale().coordinateToTime(event.clientX - bounds.left);
        const price = series.coordinateToPrice(paneY);
        if (typeof time !== 'number' || price === null) return null;
        return { time: time * 1000, price };
    };

    /** Unsnapped time/price under the pointer, valid past the last candle and outside the pane. */
    const positionPointFromPointer = (event: React.PointerEvent<HTMLDivElement>): DrawingPoint | null => {
        const chart = chartRef.current;
        const series = seriesRef.current;
        const area = plotAreaRef.current;
        if (!chart || !series || !area || !timeAnchor) return null;
        const bounds = area.getBoundingClientRect();
        const logical = chart.timeScale().coordinateToLogical(event.clientX - bounds.left);
        const price = series.coordinateToPrice(event.clientY - bounds.top);
        if (logical === null || price === null) return null;
        return { time: logicalToTime(timeAnchor, logical), price: Number(price) };
    };

    const setDragCursor = (cursor: string | null) => {
        const area = plotAreaRef.current;
        if (!area) return;
        if (cursor) {
            area.dataset.dragCursor = cursor;
            area.style.setProperty('--drag-cursor', cursor);
        } else {
            delete area.dataset.dragCursor;
        }
    };

    const handlePointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
        if (drawingModeRef.current !== 'cursor' || !drawingsVisible) return;
        plotAreaRef.current?.focus({ preventScroll: true });
        const chart = chartRef.current;
        const series = seriesRef.current;
        const area = plotAreaRef.current;
        if (!chart || !series || !area) return;
        const bounds = area.getBoundingClientRect();
        const paneX = event.clientX - bounds.left;
        const paneY = event.clientY - bounds.top;
        if (paneY < 0 || paneY > series.getPane().getHeight()) return;

        const positionHit = findPositionAtPoint(chart, series, timeAnchor, drawingsRef.current, paneX, paneY);
        if (positionHit) {
            const start = positionPointFromPointer(event);
            if (!start) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { id: positionHit.drawing.id, origin: positionHit.drawing, start, pointerId: event.pointerId, handle: positionHit.handle };
            setDragCursor(positionHit.handle === 'body' ? 'grabbing' : positionCursor(positionHit.handle));
            setSelectedDrawingId(positionHit.drawing.id);
            setToolMessage(
                positionHit.handle === 'body'
                    ? 'Position selected — drag to move it, or press Delete to remove it.'
                    : positionHit.handle === 'width'
                        ? 'Dragging the position length.'
                        : `Dragging the ${positionHit.handle} — R:R updates live.`
            );
            return;
        }

        const hit = findDrawingAtPoint(chart, series, drawingsRef.current, paneX, paneY);
        if (!hit) {
            setSelectedDrawingId(null);
            return;
        }
        const start = pointFromPointer(event);
        if (!start) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { id: hit.id, origin: hit, start, pointerId: event.pointerId };
        setSelectedDrawingId(hit.id);
        setToolMessage('Drawing selected — drag to move it, or press Delete to remove it.');
    };

    const handlePointerHover = (event: React.PointerEvent<HTMLDivElement>) => {
        const chart = chartRef.current;
        const series = seriesRef.current;
        const area = plotAreaRef.current;
        if (!chart || !series || !area) return;
        const bounds = area.getBoundingClientRect();
        const x = event.clientX - bounds.left;
        const y = event.clientY - bounds.top;
        const mode = drawingModeRef.current;
        const live = liveRef.current;

        if (mode === 'long' || mode === 'short') {
            live.preview = positionPlacement(mode, x, y);
            scheduleOverlay();
            return;
        }
        if (mode !== 'cursor' || !drawingsVisible) return;
        const hit = findPositionAtPoint(chart, series, timeAnchor, drawingsRef.current, x, y);
        setDragCursor(hit ? positionCursor(hit.handle) : null);
        const hoverId = hit?.drawing.id ?? null;
        if (hoverId !== live.hoverId) {
            live.hoverId = hoverId;
            scheduleOverlay();
        }
    };

    const handlePointerLeave = () => {
        if (dragRef.current) return;
        const live = liveRef.current;
        if (!live.preview && !live.hoverId) return;
        live.preview = null;
        live.hoverId = null;
        setDragCursor(null);
        scheduleOverlay();
    };

    const handlePointerMoveCapture = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) {
            handlePointerHover(event);
            return;
        }

        if (drag.handle) {
            const origin = positionOf(drag.origin);
            const point = positionPointFromPointer(event);
            if (!origin || !point) return;
            event.preventDefault();
            event.stopPropagation();
            liveRef.current.drawing = positionDrawing(drag.id, editPosition(origin, drag.handle, drag.start, point, stepMs));
            scheduleOverlay();
            return;
        }

        const point = pointFromPointer(event);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        const timeDelta = point.time - drag.start.time;
        const priceDelta = point.price - drag.start.price;
        liveRef.current.drawing = drag.origin.type === 'horizontal'
            ? { ...drag.origin, start: { ...drag.origin.start, price: drag.origin.start.price + priceDelta } }
            : {
                ...drag.origin,
                start: {
                    time: drag.origin.start.time + timeDelta,
                    price: drag.origin.start.price + priceDelta,
                },
                end: drag.origin.end ? {
                    time: drag.origin.end.time + timeDelta,
                    price: drag.origin.end.price + priceDelta,
                } : undefined,
            };
        scheduleOverlay();
    };

    const handlePointerUpCapture = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        dragRef.current = null;
        setDragCursor(drag.handle ? positionCursor(drag.handle) : null);
        const moved = liveRef.current.drawing;
        liveRef.current.drawing = null;
        if (!moved) return;
        // Commit synchronously to the overlay too, so the frame before React re-renders doesn't snap back.
        const next = drawingsRef.current.map((drawing) => drawing.id === moved.id ? moved : drawing);
        drawingsRef.current = next;
        overlayInputsRef.current = { ...overlayInputsRef.current, drawings: next };
        setDrawings(next);
        setRedoStack([]);
        const position = positionOf(moved);
        setToolMessage(position ? `${describePosition(position)}. Saved for this market and timeframe.` : 'Drawing moved. Changes are saved for this market and timeframe.');
    };

    const handleChartKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const key = event.key.toLowerCase();
        if (key === 'escape') {
            event.preventDefault();
            if (isFullscreen) setIsFullscreen(false);
            draftAnchorRef.current = null;
            setDraftAnchor(null);
            setSelectedDrawingId(null);
            drawingModeRef.current = 'cursor';
            setDrawingMode('cursor');
            liveRef.current.preview = null;
            scheduleOverlay();
            setToolMessage('Cursor active — drag to pan, scroll to zoom.');
            return;
        }
        if ((key === 'delete' || key === 'backspace') && selectedDrawingId) {
            event.preventDefault();
            deleteSelectedDrawing();
            return;
        }
        if (key === 'r') { event.preventDefault(); resetView(); }
        else if (key === 'g') { event.preventDefault(); goToRealtime(); }
        else if (key === 'f') { event.preventDefault(); setIsFullscreen((fullscreen) => !fullscreen); }
        else if (key === 'm') { event.preventDefault(); toggleMagnet(); }
        else if (key === 'v') {
            event.preventDefault();
            setShowVolume(!showVolume);
            setToolMessage(showVolume ? 'Volume hidden.' : 'Volume shown.');
        }
        else if (key === 't') { event.preventDefault(); setMode('trend'); }
        else if (key === 'h') { event.preventDefault(); setMode('horizontal'); }
        else if (key === 'b') { event.preventDefault(); setMode('fibonacci'); }
        else if (key === 'l') { event.preventDefault(); setMode('long'); }
        else if (key === 's') { event.preventDefault(); setMode('short'); }
        else if (key === '+' || key === '=') { event.preventDefault(); zoomChart(0.8); }
        else if (key === '-') { event.preventDefault(); zoomChart(1.25); }
    };

    const toggleAutoFib = () => {
        const nextVisible = !showAutoFib;
        setShowAutoFib(nextVisible);
        setToolMessage(
            nextVisible
                ? autoFib
                    ? 'Auto Fibonacci shown from the latest 80-candle swing.'
                    : 'Auto Fibonacci needs at least 10 candles.'
                : 'Auto Fibonacci hidden.'
        );
    };

    const handleToggleZones = () => {
        const nextVisible = !showZones;
        toggleZones();
        const liveCount = chartZones.filter((zone) => zone.status !== 'EVENT').length;
        setToolMessage(
            nextVisible
                ? liveCount > 0
                    ? `${liveCount} live supply/demand zone${liveCount === 1 ? '' : 's'} shown — the newest demand and supply are bright; ${supersededZoneIds.size} older one${supersededZoneIds.size === 1 ? '' : 's'} a newer engulfing replaced ${supersededZoneIds.size === 1 ? 'is' : 'are'} faded.`
                    : 'Zones are on, but this scan has no live supply or demand zones.'
                : 'Supply and demand zones hidden.'
        );
    };

    const toggleEngulfing = () => {
        const next = !showEngulfing;
        setShowEngulfing(next);
        setToolMessage(next
            ? 'Engulfing shown — the E marks the swallowed candle: green arrow under the last red candle = demand, red arrow over the last green candle = supply.'
            : 'Engulfing markers hidden.');
    };

    const toggleDivergences = () => {
        const next = !showDivergences;
        setShowDivergences(next);
        setToolMessage(next
            ? `${tripleDivergences.length} three-touch RSI divergence${tripleDivergences.length === 1 ? '' : 's'} on this chart — lower lows (or higher highs) while RSI stays level. Turn on RSI to see the RSI side.`
            : 'Three-touch divergences hidden.');
    };

    const toggleWickLevels = () => {
        const next = !showWickLevels;
        setShowWickLevels(next);
        setToolMessage(next
            ? `50% wick levels shown. On this chart ${wickRecord.filled} of ${wickRecord.total} long wicks came back to half` +
                (wickRecord.decided ? `, and ${wickRecord.held} of ${wickRecord.decided} then held the wick's tip.` : '.')
            : '50% wick levels hidden.');
    };

    const undoDrawing = () => {
        if (draftAnchor) {
            draftAnchorRef.current = null;
            setDraftAnchor(null);
            setToolMessage('Unfinished drawing cancelled.');
            return;
        }
        if (drawings.length === 0) {
            setToolMessage('There are no manual drawings to undo.');
            return;
        }
        const removed = drawings[drawings.length - 1];
        setDrawings((items) => items.slice(0, -1));
        setRedoStack((items) => removed ? [...items, removed] : items);
        setSelectedDrawingId(null);
        setToolMessage('Last manual drawing removed. Use Redo to restore it.');
    };

    const redoDrawing = () => {
        const restored = redoStack[redoStack.length - 1];
        if (!restored) {
            setToolMessage('There is nothing to redo.');
            return;
        }
        setRedoStack((items) => items.slice(0, -1));
        setDrawings((items) => [...items, restored]);
        setSelectedDrawingId(restored.id);
        setDrawingsVisible(true);
        setToolMessage('Drawing restored.');
    };

    const clearDrawings = () => {
        const hadDrawings = drawings.length > 0 || draftAnchor !== null || showAutoFib;
        if (drawings.length > 0) setRedoStack((items) => [...items, ...drawings]);
        setDrawings([]);
        draftAnchorRef.current = null;
        setDraftAnchor(null);
        setSelectedDrawingId(null);
        setShowAutoFib(false);
        setToolMessage(hadDrawings ? 'All manual drawings and Auto Fibonacci were cleared.' : 'There are no drawings to clear.');
    };

    return (
        <section
            id="strategy-chart"
            data-testid="strategy-chart"
            className={`min-w-0 max-w-full scroll-mt-6 ${isFullscreen ? 'fixed inset-0 z-[100] bg-[#0b0e14] p-2' : ''}`}
        >
            <div className={`flex w-full min-w-0 overflow-hidden rounded-xl border border-[#2a2e39] bg-[#131722] shadow-2xl ${isFullscreen ? 'h-full' : 'h-[620px]'}`}>
                <div className="flex min-w-0 flex-1 flex-col">
                    <div
                        className="flex min-h-11 items-center justify-between gap-2 overflow-x-auto border-b border-[#2a2e39] bg-[#131722] px-2"
                        data-testid="chart-top-toolbar"
                    >
                        <div className="flex shrink-0 items-center gap-3 text-xs">
                            <span className="font-semibold text-white">{selectedCoin}USD</span>
                            <span className="rounded bg-[var(--accent-dim)] px-1.5 py-0.5 font-semibold text-[var(--accent)]">{selectedTimeframe.toUpperCase()}</span>
                            {displayCandle && (
                                <div className="hidden items-center gap-2 font-mono text-[11px] 2xl:flex" data-testid="chart-ohlc">
                                    <span className="text-[#787b86]">O <b className="font-normal text-[#d1d4dc]">{formatPrice(displayCandle.open)}</b></span>
                                    <span className="text-[#787b86]">H <b className="font-normal text-[#26a69a]">{formatPrice(displayCandle.high)}</b></span>
                                    <span className="text-[#787b86]">L <b className="font-normal text-[#ef5350]">{formatPrice(displayCandle.low)}</b></span>
                                    <span className="text-[#787b86]">C <b className="font-normal text-[#d1d4dc]">{formatPrice(displayCandle.close)}</b></span>
                                    <span className={candleChange >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}>
                                        {candleChange >= 0 ? '+' : ''}{candleChange.toFixed(2)}%
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="flex shrink-0 items-center gap-1" role="toolbar" aria-label="Indicators and chart view controls">
                            <IndicatorButton label="EMA 20" active={showEma20} onClick={() => setShowEma20((visible) => !visible)}>
                                <Activity size={14} /><span className="2xl:hidden">20</span><span className="hidden 2xl:inline">EMA 20</span>
                            </IndicatorButton>
                            <IndicatorButton label="EMA 50" active={showEma50} onClick={() => setShowEma50((visible) => !visible)}>
                                <Activity size={14} /><span className="2xl:hidden">50</span><span className="hidden 2xl:inline">EMA 50</span>
                            </IndicatorButton>
                            <IndicatorButton label="RSI 14" active={showRsi} onClick={onToggleRsi}>
                                <Activity size={14} /><span>RSI</span>
                            </IndicatorButton>
                            <IndicatorButton label="Bollinger Bands" active={showBollinger} onClick={onToggleBollinger}>
                                <GalleryVerticalEnd size={14} /><span>BB</span>
                            </IndicatorButton>
                            <IndicatorButton label="Volume (V)" active={showVolume} onClick={() => setShowVolume((visible) => !visible)}>
                                <BarChart3 size={14} /><span className="hidden 2xl:inline">Volume</span>
                            </IndicatorButton>
                            <span className="mx-1 h-6 w-px bg-[#2a2e39]" />
                            <TopIconButton label="Zoom out (-)" onClick={() => zoomChart(1.25)}><ZoomOut size={17} /></TopIconButton>
                            <TopIconButton label="Zoom in (+)" onClick={() => zoomChart(0.8)}><ZoomIn size={17} /></TopIconButton>
                            <TopIconButton label="Reset chart view (R)" onClick={resetView}><RotateCcw size={17} /></TopIconButton>
                            <TopIconButton label="Go to realtime (G)" onClick={goToRealtime}><ChevronsRight size={18} /></TopIconButton>
                            <TopIconButton
                                label={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen chart (F)'}
                                onClick={() => setIsFullscreen((fullscreen) => !fullscreen)}
                            >
                                {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                            </TopIconButton>
                        </div>
                    </div>

                    <div className="flex min-h-0 flex-1">
                        <aside className="flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-[#2a2e39] bg-[#131722] py-2" role="toolbar" aria-label="Chart drawing tools">
                            <ToolButton label="Cursor (Esc)" active={drawingMode === 'cursor'} onClick={() => setMode('cursor')}><MousePointer2 size={18} /></ToolButton>
                            <ToolButton label="Trend line (T)" active={drawingMode === 'trend'} onClick={() => setMode('trend')}><TrendingUp size={18} /></ToolButton>
                            <ToolButton label="Horizontal line (H)" active={drawingMode === 'horizontal'} onClick={() => setMode('horizontal')}><Minus size={19} /></ToolButton>
                            <ToolButton label="Fibonacci retracement (B)" active={drawingMode === 'fibonacci'} onClick={() => setMode('fibonacci')}><GalleryVerticalEnd size={18} /></ToolButton>
                            <ToolButton label="Long position (L)" active={drawingMode === 'long'} onClick={() => setMode('long')}><PositionIcon side="long" /></ToolButton>
                            <ToolButton label="Short position (S)" active={drawingMode === 'short'} onClick={() => setMode('short')}><PositionIcon side="short" /></ToolButton>
                            <div className="my-1 h-px w-7 bg-[#2a2e39]" />
                            <ToolButton label="Auto Fibonacci" active={showAutoFib} onClick={toggleAutoFib}><Activity size={18} /></ToolButton>
                            <ToolButton label="Supply and demand zones" active={showZones} onClick={handleToggleZones}><Layers3 size={18} /></ToolButton>
                            <ToolButton label="Engulfing candles" active={showEngulfing} onClick={toggleEngulfing}><ChartCandlestick size={18} /></ToolButton>
                            <ToolButton label="Three-touch RSI divergence" active={showDivergences} onClick={toggleDivergences}><Spline size={18} /></ToolButton>
                            <ToolButton label="50% wick levels" active={showWickLevels} onClick={toggleWickLevels}><SeparatorHorizontal size={18} /></ToolButton>
                            <ToolButton label="Magnet mode (M)" active={magnetEnabled} onClick={toggleMagnet}><Magnet size={18} /></ToolButton>
                            <ToolButton label="Keep drawing" active={keepDrawing} onClick={toggleKeepDrawing}><Repeat2 size={18} /></ToolButton>
                            <ToolButton
                                label={drawingsVisible ? 'Hide manual drawings' : 'Show manual drawings'}
                                active={!drawingsVisible}
                                onClick={() => setDrawingsVisible((visible) => !visible)}
                            >
                                {drawingsVisible ? <Eye size={18} /> : <EyeOff size={18} />}
                            </ToolButton>
                            <div className="my-1 h-px w-7 bg-[#2a2e39]" />
                            <ToolButton label="Undo drawing" active={false} toggle={false} disabled={drawings.length === 0 && !draftAnchor} onClick={undoDrawing}><Undo2 size={18} /></ToolButton>
                            <ToolButton label="Redo drawing" active={false} toggle={false} disabled={redoStack.length === 0} onClick={redoDrawing}><Redo2 size={18} /></ToolButton>
                            <ToolButton label="Remove selected drawing" active={false} toggle={false} disabled={!selectedDrawingId} onClick={deleteSelectedDrawing}><Trash2 size={18} /></ToolButton>
                            <ToolButton label="Clear all drawings" active={false} toggle={false} onClick={clearDrawings}><GalleryVerticalEnd size={18} /></ToolButton>
                        </aside>

                        <div
                            ref={plotAreaRef}
                            className={`chart-plot-area relative min-w-0 flex-1 overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${drawingMode === 'cursor' ? '' : 'cursor-crosshair'}`}
                            data-testid="chart-plot-area"
                            tabIndex={0}
                            aria-label="Interactive trading chart. Use the mouse wheel to zoom, drag to pan, or use the drawing toolbar."
                            onKeyDown={handleChartKeyDown}
                            onPointerDownCapture={handlePointerDownCapture}
                            onPointerMoveCapture={handlePointerMoveCapture}
                            onPointerUpCapture={handlePointerUpCapture}
                            onPointerCancelCapture={handlePointerUpCapture}
                            onPointerLeave={handlePointerLeave}
                            onDoubleClickCapture={() => drawingModeRef.current === 'cursor' && resetView()}
                        >
                            <div ref={containerRef} className="chart-container h-full" />

                            <ChartOverlaySvg ref={overlayHandleRef} />

                            {isLoading && (
                                <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#131722]">
                                    <div className="flex flex-col items-center gap-3 text-[#787b86]">
                                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2a2e39] border-t-[var(--accent)]" />
                                        Loading verified Hyperliquid candles...
                                    </div>
                                </div>
                            )}

                            {drawingMode !== 'cursor' && (
                                <div className="pointer-events-none absolute left-3 top-3 z-[4] rounded-md border border-[var(--accent)]/50 bg-[#131722]/95 px-3 py-2 text-xs text-[#d1d4dc] shadow-lg" data-testid="drawing-mode-banner">
                                    <div className="font-semibold uppercase tracking-wider text-[var(--accent)]">
                                        {drawingMode === 'horizontal'
                                            ? 'Horizontal line'
                                            : drawingMode === 'fibonacci'
                                                ? 'Fibonacci retracement'
                                                : drawingMode === 'long'
                                                    ? 'Long position'
                                                    : drawingMode === 'short' ? 'Short position' : 'Trend line'}
                                    </div>
                                    <div className="mt-1 text-[#9598a1]">
                                        {draftAnchor
                                            ? 'Click the second anchor to finish.'
                                            : drawingMode === 'horizontal'
                                                ? 'Click one price level.'
                                                : drawingMode === 'long' || drawingMode === 'short'
                                                    ? 'Click your entry — then drag the edges to set stop and target.'
                                                    : 'Click the first anchor.'}
                                        {magnetEnabled ? ' Magnet is on.' : ''}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[#2a2e39] bg-[#131722] px-3 py-1.5 text-[11px]">
                        <div
                            className="min-w-0 truncate text-[#9598a1]"
                            role="status"
                            aria-live="polite"
                            data-testid="chart-tool-status"
                        >
                            {toolMessage}
                        </div>
                        {signalToPlot ? (
                            <div className="flex flex-wrap items-center gap-3 font-mono" data-testid="plotted-setup">
                                <span className="font-sans font-semibold uppercase tracking-wider text-[var(--accent)]">Plotted {signalToPlot.direction} {signalToPlot.coin}</span>
                                <span className="text-[#fbbf24]">Entry {formatPrice(signalToPlot.entryPrice)}</span>
                                <span className="text-[#ef5350]">Stop {formatPrice(signalToPlot.stopLoss)}</span>
                                <span className="text-[#26a69a]">Target {formatPrice(signalToPlot.takeProfit)}</span>
                                <span className="text-[#d1d4dc]">1:{signalToPlot.riskRewardRatio.toFixed(2)} R:R</span>
                                <span className="font-sans text-[#9598a1]">
                                    EVENT = broken zone that proved momentum · ORIGIN = zone your limit rests in
                                </span>
                                <span className="flex items-center gap-1.5 font-sans text-[#9598a1]" data-testid="setup-trigger-legend">
                                    <span className="w-4 shrink-0 border-t border-dashed border-[#a78bfa]" aria-hidden="true" />
                                    Purple dashed line = break confirmed.
                                    <span className="h-2 w-2 shrink-0 rounded-full bg-[#fbbf24]" aria-hidden="true" />
                                    Yellow dot = setup trigger. Entry fills only if price returns to the yellow line.
                                </span>
                            </div>
                        ) : (
                            <div className="hidden items-center gap-3 text-[#5d606b] md:flex" data-testid="chart-rule-legend">
                                <span><b className="text-[#00d26a]">E</b> engulfing (swallowed candle)</span>
                                <span><b className="text-[#22c55e]">···</b> 3-touch RSI div</span>
                                <span><b className="text-[#22d3ee]">- -</b> 50% wick</span>
                                <span>T/H/B draw</span><span>L/S position</span><span>M magnet</span><span>R reset</span><span>G realtime</span><span>+/- zoom</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}

function ToolButton({
    label,
    active,
    toggle = true,
    disabled = false,
    onClick,
    children,
}: {
    label: string;
    active: boolean;
    toggle?: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            disabled={disabled}
            aria-pressed={toggle ? active : undefined}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                active
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[#9598a1] hover:bg-[#2a2e39] hover:text-white'
            }`}
        >
            {children}
        </button>
    );
}

/** Mirrors TradingView's forecasting icons: reward side carries the letter. */
function PositionIcon({ side }: { side: PositionSide }) {
    const letterY = side === 'long' ? 6.4 : 13.6;
    return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
            <circle cx="3" cy="2.5" r="1.5" />
            <path d="M4.5 2.5H18" />
            <path d="M6.5 10H18" />
            <circle cx="3" cy="17.5" r="1.5" />
            <path d="M4.5 17.5H18" />
            <text
                x="12.25"
                y={letterY}
                fill="currentColor"
                stroke="none"
                fontSize="6"
                fontWeight="700"
                textAnchor="middle"
                dominantBaseline="central"
            >
                {side === 'long' ? 'L' : 'S'}
            </text>
        </svg>
    );
}

function TopIconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[#9598a1] transition-colors hover:bg-[#2a2e39] hover:text-white"
        >
            {children}
        </button>
    );
}

function IndicatorButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            aria-pressed={active}
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded px-2 text-[11px] font-medium transition-colors ${
                active ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[#9598a1] hover:bg-[#2a2e39] hover:text-white'
            }`}
        >
            {children}
        </button>
    );
}
