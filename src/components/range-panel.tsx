'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Play, RotateCcw } from 'lucide-react';
import RangeChart from '@/components/range-chart';
import { StrategyRecordCard } from '@/components/strategy-record-card';
import { getCandleSnapshot } from '@/lib/api/hyperliquid-client';
import { BACKTEST_MAX_CANDLES } from '@/lib/backtest/run-all';
import {
    DEFAULT_RANGE_PARAMS,
    planRangeTrade,
    replayRange,
    toRangeHistory,
    type RangeParams,
    type RangeTrade,
} from '@/lib/range/range-engine';
import { getTimeframeMs, type Candle, type Timeframe } from '@/lib/trading/types';
import { formatPrice } from '@/lib/ui/format-price';
import type { OutcomeHistoryItem } from '@/lib/ui/strategy-record';
import { useTradingStore } from '@/store/trading-store';

const TIMEFRAMES: readonly Timeframe[] = ['1h', '4h'];
const LIVE_REFRESH_MS = 60_000;
const REQUEST_SPACING_MS = 300;
const NO_CANDLES: Candle[] = [];

const PARAM_FIELDS: ReadonlyArray<{
    key: Exclude<keyof RangeParams, 'requireEngulfing'>;
    label: string;
    hint: string;
    min: number;
    max: number;
    step: number;
}> = [
    { key: 'entryInsetPercent', label: 'Enter before the line (%)', hint: 'How far inside the range, short of the swing high or low, the entry sits.', min: 0, max: 10, step: 0.1 },
    { key: 'stopBufferPercent', label: 'Stop beyond the line (%)', hint: 'How far outside the swing high or low the stop sits. A candle closing past it ends the range.', min: 0.1, max: 10, step: 0.1 },
    { key: 'minRangePercent', label: 'Smallest range (%)', hint: 'Highs and lows closer together than this are ignored.', min: 1, max: 50, step: 0.5 },
    { key: 'maxRangePercent', label: 'Largest range (%)', hint: 'Further apart than this is a trend leg, not a range.', min: 5, max: 100, step: 1 },
    { key: 'pivotLookback', label: 'Swing lookback (candles)', hint: 'A high or low must be the extreme of this many candles before it.', min: 3, max: 200, step: 1 },
    { key: 'pivotConfirm', label: 'Candles to confirm a swing', hint: 'How many candles must pass without beating the high or low before it counts.', min: 1, max: 50, step: 1 },
];

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function closedOnly(candles: readonly Candle[], timeframe: Timeframe, now: number): Candle[] {
    const duration = getTimeframeMs(timeframe);
    return candles.filter((candle) => candle.time + duration <= now);
}

function loadHistory(coin: string, timeframe: Timeframe, now: number): Promise<Candle[]> {
    return getCandleSnapshot(coin, timeframe, now - (BACKTEST_MAX_CANDLES * getTimeframeMs(timeframe)), now);
}

interface PlanRowProps {
    title: string;
    armed: boolean;
    trade: RangeTrade;
}

function PlanRow({ title, armed, trade }: PlanRowProps) {
    const long = trade.direction === 'LONG';
    return (
        <div className="rounded-lg border border-[var(--card-border)] p-3">
            <div className="flex items-center justify-between gap-2">
                <span className={`badge ${long ? 'badge-long' : 'badge-short'}`}>{trade.direction}</span>
                <span className={`text-[11px] font-semibold ${armed ? 'text-amber-200' : 'text-[var(--text-muted)]'}`}>
                    {armed ? 'Armed' : 'Not armed'}
                </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed">{title}</p>
            <dl className="mt-2 grid grid-cols-4 gap-2 text-[11px]">
                <div>
                    <dt className="text-[var(--text-muted)]">Entry</dt>
                    <dd className="font-mono font-semibold text-amber-300">{formatPrice(trade.entryPrice)}</dd>
                </div>
                <div>
                    <dt className="text-[var(--text-muted)]">Stop</dt>
                    <dd className="font-mono font-semibold text-[var(--short-red)]">{formatPrice(trade.stopLoss)}</dd>
                </div>
                <div>
                    <dt className="text-[var(--text-muted)]">Target</dt>
                    <dd className="font-mono font-semibold text-[var(--long-green)]">{formatPrice(trade.takeProfit)}</dd>
                </div>
                <div>
                    <dt className="text-[var(--text-muted)]">R:R</dt>
                    <dd className="font-mono font-semibold">1:{trade.riskReward.toFixed(1)}</dd>
                </div>
            </dl>
        </div>
    );
}

export default function RangePanel() {
    const coins = useTradingStore((state) => state.availableCoins);

    const [coinInput, setCoinInput] = useState('BTC');
    const [coin, setCoin] = useState('BTC');
    const [timeframe, setTimeframe] = useState<Timeframe>('1h');
    const [params, setParams] = useState<RangeParams>(DEFAULT_RANGE_PARAMS);
    const [candles, setCandles] = useState<Candle[]>([]);
    const [loadedMarket, setLoadedMarket] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [now, setNow] = useState(0);
    const [allMarkets, setAllMarkets] = useState<OutcomeHistoryItem[] | null>(null);
    const [allProgress, setAllProgress] = useState<string | null>(null);
    const cancelledRef = useRef(false);

    const market = `${coin}:${timeframe}`;
    const isLoading = loadedMarket !== market && error === null;

    useEffect(() => () => {
        cancelledRef.current = true;
    }, []);

    useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();

        const load = async () => {
            try {
                const history = await getCandleSnapshot(
                    coin,
                    timeframe,
                    Date.now() - (BACKTEST_MAX_CANDLES * getTimeframeMs(timeframe)),
                    Date.now(),
                    controller.signal
                );
                if (cancelled) return;
                setCandles(history);
                setLoadedMarket(`${coin}:${timeframe}`);
                setNow(Date.now());
                setError(null);
            } catch (loadError) {
                if (cancelled || (loadError instanceof DOMException && loadError.name === 'AbortError')) return;
                setError(`Could not load ${coin} ${timeframe} from Hyperliquid. Check the coin name and try again.`);
            }
        };
        void load();

        // Only the newest candles change, so a refresh fetches a handful and merges them in.
        const interval = setInterval(() => {
            const refreshedAt = Date.now();
            void getCandleSnapshot(coin, timeframe, refreshedAt - (3 * getTimeframeMs(timeframe)), refreshedAt, controller.signal)
                .then((latest) => {
                    if (cancelled) return;
                    setCandles((current) => {
                        const byTime = new Map(current.map((candle) => [candle.time, candle]));
                        for (const candle of latest) byTime.set(candle.time, candle);
                        return Array.from(byTime.values()).sort((first, second) => first.time - second.time);
                    });
                    setNow(refreshedAt);
                })
                .catch(() => {
                    // A missed refresh is retried on the next tick.
                });
        }, LIVE_REFRESH_MS);

        return () => {
            cancelled = true;
            controller.abort();
            clearInterval(interval);
        };
    }, [coin, timeframe]);

    const shownCandles = loadedMarket === market ? candles : NO_CANDLES;
    const replay = useMemo(
        () => replayRange(closedOnly(shownCandles, timeframe, now), timeframe, params),
        [shownCandles, timeframe, now, params]
    );
    const history = useMemo(
        () => toRangeHistory(replay.trades, coin, timeframe),
        [replay, coin, timeframe]
    );
    const lastPrice = shownCandles.at(-1)?.close ?? 0;
    const range = replay.activeRange;

    const submitCoin = () => {
        const next = coinInput.trim().toUpperCase();
        if (!next) return;
        setCoinInput(next);
        setError(null);
        setCoin(next);
    };

    const testAllMarkets = async () => {
        cancelledRef.current = false;
        setAllMarkets(null);
        const startedAt = Date.now();
        const results: OutcomeHistoryItem[] = [];
        for (const marketTimeframe of TIMEFRAMES) {
            for (const marketCoin of coins) {
                if (cancelledRef.current) return;
                setAllProgress(`${marketCoin} ${marketTimeframe}`);
                try {
                    const loaded = closedOnly(await loadHistory(marketCoin, marketTimeframe, startedAt), marketTimeframe, startedAt);
                    results.push(...toRangeHistory(replayRange(loaded, marketTimeframe, params).trades, marketCoin, marketTimeframe));
                } catch {
                    // A market that fails to load is left out of the totals.
                }
                await delay(REQUEST_SPACING_MS);
            }
        }
        if (cancelledRef.current) return;
        setAllProgress(null);
        setAllMarkets(results.sort((first, second) => first.closedAt - second.closedAt));
    };

    return (
        <main className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold">Range strategy</h1>
                    <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
                        Marks a range between a swing high and the swing low that answers it, then shorts just under the high
                        and buys just above the low until a candle closes outside it. Planning only — no exchange orders.
                    </p>
                </div>
                <Link href="/dashboard" className="btn btn-outline text-xs">
                    <ArrowLeft aria-hidden="true" size={16} />
                    Dashboard
                </Link>
            </header>

            <section className="card flex flex-wrap items-end gap-4" aria-label="Market">
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        submitCoin();
                    }}
                    className="flex items-end gap-2"
                >
                    <div>
                        <label htmlFor="range-coin" className="block text-xs font-medium text-[var(--text-muted)]">Coin</label>
                        <input
                            id="range-coin"
                            list="range-coins"
                            value={coinInput}
                            onChange={(event) => setCoinInput(event.target.value)}
                            className="input mt-1 w-28 uppercase"
                            autoComplete="off"
                            spellCheck={false}
                        />
                        <datalist id="range-coins">
                            {coins.map((item) => <option key={item} value={item} />)}
                        </datalist>
                    </div>
                    <button type="submit" className="btn btn-outline text-xs">Load</button>
                </form>

                <div>
                    <span className="block text-xs font-medium text-[var(--text-muted)]">Timeframe</span>
                    <div className="mt-1 flex gap-2">
                        {TIMEFRAMES.map((item) => (
                            <button
                                key={item}
                                type="button"
                                aria-pressed={timeframe === item}
                                onClick={() => setTimeframe(item)}
                                className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                                    timeframe === item
                                        ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                                        : 'border-[var(--card-border)] text-[var(--text-muted)] hover:text-white'
                                }`}
                            >
                                {item}
                            </button>
                        ))}
                    </div>
                </div>

                <p className="ml-auto text-right text-xs text-[var(--text-muted)]" role="status" aria-live="polite">
                    {isLoading
                        ? `Loading ${coin} ${timeframe}…`
                        : error ?? (
                            <>
                                <span className="block font-mono text-lg font-semibold text-[var(--foreground)]">
                                    {coin} ${formatPrice(lastPrice)}
                                </span>
                                {replay.ranges.length} ranges found in {shownCandles.length.toLocaleString()} candles
                            </>
                        )}
                </p>
            </section>

            <RangeChart
                candles={shownCandles}
                timeframe={timeframe}
                ranges={replay.ranges}
                trades={replay.trades}
                openTrade={replay.openTrade}
            />

            <div className="grid gap-4 lg:grid-cols-2">
                <section className="card space-y-3" aria-label="Current range">
                    <h2 className="text-sm font-semibold">Right now</h2>
                    {!range ? (
                        <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                            No range on {coin} {timeframe}. One appears when a swing high and a swing low sit
                            {' '}{params.minRangePercent}–{params.maxRangePercent}% apart with price between them.
                            {replay.openTrade && ' The last range has broken, but its final trade is still open.'}
                        </p>
                    ) : (
                        <>
                            <p className="text-xs leading-relaxed">
                                Range low <span className="font-mono font-semibold text-[var(--long-green)]">{formatPrice(range.bottom.distalLine)}</span>
                                {' '}to range high <span className="font-mono font-semibold text-[var(--short-red)]">{formatPrice(range.top.distalLine)}</span>
                                {' '}({(((range.top.distalLine - range.bottom.distalLine) / range.bottom.distalLine) * 100).toFixed(1)}% tall),
                                confirmed {new Date(range.confirmedAt).toLocaleString()}.
                                It ends when a candle closes beyond either stop.
                            </p>
                            {replay.openTrade ? (
                                <PlanRow
                                    title={`In a ${replay.openTrade.direction.toLowerCase()} since ${new Date(replay.openTrade.openedAt).toLocaleString()}. The opposite side opens when this one reaches its target.`}
                                    armed
                                    trade={replay.openTrade}
                                />
                            ) : (
                                <>
                                    <PlanRow
                                        title={replay.armed.short
                                            ? 'Short when price climbs back to just under the range high.'
                                            : 'Waiting for a candle to close back below the short entry before shorting again.'}
                                        armed={replay.armed.short}
                                        trade={planRangeTrade('SHORT', range, 0, params)}
                                    />
                                    <PlanRow
                                        title={replay.armed.long
                                            ? 'Long when price drops back to just above the range low.'
                                            : 'Waiting for a candle to close back above the long entry before buying again.'}
                                        armed={replay.armed.long}
                                        trade={planRangeTrade('LONG', range, 0, params)}
                                    />
                                </>
                            )}
                        </>
                    )}
                    {replay.openTrade && !range && (
                        <PlanRow title="Still open from the last range." armed trade={replay.openTrade} />
                    )}
                </section>

                <section className="card space-y-3" aria-label="Range rules">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold">Rules</h2>
                        <button
                            type="button"
                            onClick={() => setParams(DEFAULT_RANGE_PARAMS)}
                            className="btn btn-outline text-xs"
                        >
                            <RotateCcw aria-hidden="true" size={14} />
                            Reset
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        {PARAM_FIELDS.map((field) => (
                            <div key={field.key}>
                                <label htmlFor={`range-${field.key}`} className="block text-xs font-medium" title={field.hint}>
                                    {field.label}
                                </label>
                                <input
                                    id={`range-${field.key}`}
                                    type="number"
                                    value={params[field.key]}
                                    min={field.min}
                                    max={field.max}
                                    step={field.step}
                                    onChange={(event) => {
                                        const value = parseFloat(event.target.value);
                                        if (!Number.isFinite(value)) return;
                                        setParams((current) => ({
                                            ...current,
                                            [field.key]: Math.min(field.max, Math.max(field.min, value)),
                                        }));
                                    }}
                                    className="input mt-1 w-full"
                                />
                            </div>
                        ))}
                    </div>
                    <label className="flex cursor-pointer items-start justify-between gap-4">
                        <span>
                            <span className="block text-xs font-medium">Only swings with an engulfing candle</span>
                            <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                                Count a high only if a bearish engulfing printed as it turned, and a low only with a bullish one.
                            </span>
                        </span>
                        <input
                            type="checkbox"
                            checked={params.requireEngulfing}
                            onChange={(event) => setParams((current) => ({
                                ...current,
                                requireEngulfing: event.target.checked,
                            }))}
                            className="mt-1 h-4 w-4 accent-[var(--accent)]"
                        />
                    </label>
                    <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                        Changing a rule redraws the chart and re-runs the record below straight away.
                        Hover a label for what it does.
                    </p>
                </section>
            </div>

            <StrategyRecordCard
                key={market}
                history={history}
                now={now}
                title={`How it would have done on ${coin} ${timeframe}`}
                defaultWindow="all"
            />

            <section className="card space-y-3" aria-label="All markets">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-semibold">Test these rules on every market</h2>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                            Replays {coins.length} coins on 1h and 4h with the rules above. One coin can look good by luck; this is the fairer test.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void testAllMarkets()}
                        disabled={allProgress !== null}
                        className="btn btn-primary text-xs disabled:opacity-60"
                    >
                        <Play aria-hidden="true" size={14} />
                        {allProgress ? `Replaying ${allProgress}…` : 'Test all markets'}
                    </button>
                </div>
            </section>

            {allMarkets && (
                <StrategyRecordCard
                    history={allMarkets}
                    now={now}
                    title="All markets, 1h and 4h"
                    defaultWindow="all"
                />
            )}

            <section className="card text-xs leading-relaxed text-[var(--text-muted)]" aria-label="How to read this">
                <h2 className="text-sm font-semibold text-[var(--foreground)]">How to read this</h2>
                <ul className="mt-2 list-disc space-y-1.5 pl-5">
                    <li>
                        The red band sits under the range high: its top edge is the swing high and its bottom edge is the short entry.
                        The green band sits over the range low the same way. Faded bands are ranges that have already broken.
                        Arrows mark entries; dots mark where each trade hit its target or stop.
                    </li>
                    <li>
                        The app calls a swing a few candles after it prints, using only what was known then.
                        It will not always pick the same high and low you would by eye.
                    </li>
                    <li>
                        The last trade of every range is a loss, because the range only ends by breaking.
                        The strategy pays only if the swings before the break outweigh it.
                    </li>
                    <li>
                        Results use Hyperliquid candles and your fee settings. Ties go against you:
                        a candle that touches both stop and target counts as a loss. Funding and slippage are not included.
                    </li>
                </ul>
            </section>
        </main>
    );
}
