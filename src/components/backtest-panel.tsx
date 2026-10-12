'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Play, RotateCcw, Square } from 'lucide-react';
import { StrategyRecordCard } from '@/components/strategy-record-card';
import { getCandleSnapshot } from '@/lib/api/hyperliquid-client';
import {
    runBacktest,
    type BacktestProgress,
    type BacktestRun,
} from '@/lib/backtest/run-all';
import type { Timeframe } from '@/lib/trading/types';
import { formatRMultiple, getRToneClass } from '@/lib/ui/format-r';
import { calculateStrategyRecord } from '@/lib/ui/strategy-record';
import { useTradingStore } from '@/store/trading-store';

const TIMEFRAMES: readonly Timeframe[] = ['5m', '15m', '1h', '4h'];
const DAY_MS = 24 * 60 * 60 * 1000;
// Hyperliquid's public API is rate limited; the live scanner spaces requests the same way.
const REQUEST_SPACING_MS = 300;

interface Experiment {
    minStopDistancePercent: number;
    minRiskReward: number;
    maxRiskRewardRatio: number;
    entryOffsetPercent: number;
}

const EXPERIMENT_FIELDS: ReadonlyArray<{
    key: keyof Experiment;
    label: string;
    hint: string;
    min: number;
    max: number;
    step: number;
}> = [
    { key: 'minStopDistancePercent', label: 'Minimum stop (%)', hint: 'Setups with a tighter stop are skipped.', min: 0, max: 25, step: 0.1 },
    { key: 'minRiskReward', label: 'Minimum R:R', hint: 'Setups paying less than this are skipped. The live scanner uses 2.', min: 1, max: 20, step: 0.5 },
    { key: 'maxRiskRewardRatio', label: 'Maximum R:R', hint: 'Setups promising more than this are skipped as unrealistic.', min: 2, max: 100, step: 0.5 },
    { key: 'entryOffsetPercent', label: 'Shallower entry (%)', hint: 'Moves the entry this far out of the zone so shallow pullbacks still fill. The live scanner uses 0.', min: 0, max: 5, step: 0.05 },
];

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Lets the page repaint. Unlike a timer, a message is not slowed down in a background tab. */
function yieldToPage(): Promise<void> {
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => resolve();
        channel.port2.postMessage(null);
    });
}

export default function BacktestPanel() {
    const coins = useTradingStore((state) => state.availableCoins);
    const minStopDistancePercent = useTradingStore((state) => state.settings.minStopDistancePercent);
    const maxRiskRewardRatio = useTradingStore((state) => state.settings.maxRiskRewardRatio);
    const makerFeePercent = useTradingStore((state) => state.settings.makerFeePercent);
    const takerFeePercent = useTradingStore((state) => state.settings.takerFeePercent);

    const [timeframes, setTimeframes] = useState<Timeframe[]>(['15m', '1h', '4h']);
    // What-if rules for this page only. Anything left alone follows the live settings.
    const [overrides, setOverrides] = useState<Partial<Experiment>>({});
    const experiment: Experiment = {
        minStopDistancePercent,
        minRiskReward: 2,
        maxRiskRewardRatio,
        entryOffsetPercent: 0,
        ...overrides,
    };
    const isExperiment = Object.keys(overrides).length > 0;
    const [progress, setProgress] = useState<BacktestProgress | null>(null);
    const [run, setRun] = useState<BacktestRun | null>(null);
    const [finishedAt, setFinishedAt] = useState(0);
    const cancelledRef = useRef(false);
    const isRunning = progress !== null;

    useEffect(() => () => {
        cancelledRef.current = true;
    }, []);

    const toggleTimeframe = (timeframe: Timeframe) => {
        setTimeframes((current) => current.includes(timeframe)
            ? current.filter((item) => item !== timeframe)
            : TIMEFRAMES.filter((item) => item === timeframe || current.includes(item)));
    };

    const start = async () => {
        cancelledRef.current = false;
        setRun(null);
        const now = Date.now();
        let lastRequestAt = 0;

        const result = await runBacktest({
            coins,
            timeframes,
            settings: experiment,
            now,
            fetchCandles: async (coin, timeframe, startTime, endTime) => {
                const request = async () => {
                    const wait = REQUEST_SPACING_MS - (Date.now() - lastRequestAt);
                    if (wait > 0) await delay(wait);
                    lastRequestAt = Date.now();
                    return getCandleSnapshot(coin, timeframe, startTime, endTime);
                };
                // One retry rides out a rate-limit blip without failing the market.
                return request().catch(async () => {
                    await delay(2000);
                    return request();
                });
            },
            onProgress: setProgress,
            pause: yieldToPage,
            isCancelled: () => cancelledRef.current,
        });

        setProgress(null);
        if (result) {
            setRun(result);
            setFinishedAt(now);
        }
    };

    const total = useMemo(
        () => run
            ? calculateStrategyRecord(run.results, 'all', finishedAt, { makerFeePercent, takerFeePercent })
            : null,
        [run, finishedAt, makerFeePercent, takerFeePercent]
    );
    const totalR = total ? total.netR ?? total.grossR : 0;

    return (
        <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold">Backtest</h1>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                        Replays the live scanner over past Hyperliquid candles to show how its plans would have done.
                    </p>
                </div>
                <Link href="/dashboard" className="btn btn-outline text-xs">
                    <ArrowLeft aria-hidden="true" size={16} />
                    Dashboard
                </Link>
            </header>

            <section className="card space-y-4" aria-label="Backtest setup">
                <div>
                    <h2 className="text-sm font-semibold">Timeframes</h2>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {TIMEFRAMES.map((timeframe) => (
                            <button
                                key={timeframe}
                                type="button"
                                aria-pressed={timeframes.includes(timeframe)}
                                disabled={isRunning}
                                onClick={() => toggleTimeframe(timeframe)}
                                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                                    timeframes.includes(timeframe)
                                        ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                                        : 'border-[var(--card-border)] text-[var(--text-muted)] hover:text-white'
                                }`}
                            >
                                {timeframe}
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold">Rules to test</h2>
                        {isExperiment && (
                            <button
                                type="button"
                                disabled={isRunning}
                                onClick={() => setOverrides({})}
                                className="btn btn-outline text-xs disabled:opacity-60"
                            >
                                <RotateCcw aria-hidden="true" size={14} />
                                Back to live rules
                            </button>
                        )}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {EXPERIMENT_FIELDS.map((field) => (
                            <div key={field.key}>
                                <label htmlFor={`backtest-${field.key}`} className="block text-xs font-medium" title={field.hint}>
                                    {field.label}
                                </label>
                                <input
                                    id={`backtest-${field.key}`}
                                    type="number"
                                    value={experiment[field.key]}
                                    min={field.min}
                                    max={field.max}
                                    step={field.step}
                                    disabled={isRunning}
                                    onChange={(event) => {
                                        const value = parseFloat(event.target.value);
                                        if (!Number.isFinite(value)) return;
                                        setOverrides((current) => ({
                                            ...current,
                                            [field.key]: Math.min(field.max, Math.max(field.min, value)),
                                        }));
                                    }}
                                    className="input mt-1 w-full disabled:opacity-60"
                                />
                            </div>
                        ))}
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
                        {isExperiment
                            ? 'These are what-if rules for this test only. Your live scanner is not changed.'
                            : 'These match your live scanner. Change one to see what a different rule would have done; your live settings stay as they are.'}
                    </p>
                </div>

                <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                    Tests {coins.length} markets with fees of {makerFeePercent}% maker / {takerFeePercent}% taker.
                    Hyperliquid keeps 5,000 candles per timeframe, so 5m reaches back about 17 days,
                    15m about 7 weeks, 1h about 7 months, and 4h over 2 years.
                </p>

                {isRunning ? (
                    <div className="space-y-2" role="status" aria-live="polite">
                        <div className="flex items-center justify-between gap-3 text-xs">
                            <span>
                                {progress.current ? `Replaying ${progress.current}` : 'Finishing'} · {progress.completed} of {progress.total} markets
                            </span>
                            <button
                                type="button"
                                onClick={() => {
                                    cancelledRef.current = true;
                                }}
                                className="btn btn-outline text-xs"
                            >
                                <Square aria-hidden="true" size={14} />
                                Stop
                            </button>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--card-border)]">
                            <div
                                className="h-full bg-[var(--accent)] transition-[width] duration-300"
                                style={{ width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%` }}
                            />
                        </div>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => void start()}
                        disabled={timeframes.length === 0 || coins.length === 0}
                        className="btn btn-primary disabled:opacity-60"
                    >
                        <Play aria-hidden="true" size={16} />
                        Run backtest
                    </button>
                )}
            </section>

            {run && total && (
                <>
                    <section className="card" aria-label="Backtest result">
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
                            <div>
                                <dt className="text-[var(--text-muted)]">Trades taken</dt>
                                <dd className="mt-0.5 font-mono text-base font-semibold">{total.resolved}</dd>
                            </div>
                            <div>
                                <dt className="text-[var(--text-muted)]">Win rate</dt>
                                <dd className="mt-0.5 font-mono text-base font-semibold">
                                    {total.resolved > 0 ? `${((total.wins / total.resolved) * 100).toFixed(0)}%` : '—'}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-[var(--text-muted)]">Total R after fees</dt>
                                <dd className={`mt-0.5 font-mono text-base font-semibold ${getRToneClass(totalR)}`}>
                                    {total.resolved > 0 ? formatRMultiple(totalR) : '—'}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-[var(--text-muted)]">R per trade</dt>
                                <dd className={`mt-0.5 font-mono text-base font-semibold ${getRToneClass(totalR)}`}>
                                    {total.resolved > 0 ? (totalR / total.resolved).toFixed(2).replace('-', '−') : '—'}
                                </dd>
                            </div>
                        </dl>

                        <ul className="mt-4 space-y-1 border-t border-[var(--card-border)] pt-3 text-xs text-[var(--text-muted)]">
                            {run.coverage.map((item) => (
                                <li key={item.timeframe}>
                                    <span className="font-semibold text-[var(--foreground)]">{item.timeframe}</span>
                                    {' '}covers {Math.round((item.to - item.from) / DAY_MS)} days,
                                    from {new Date(item.from).toLocaleDateString()} to {new Date(item.to).toLocaleDateString()}
                                </li>
                            ))}
                            <li>
                                {run.invalidated} plans were cancelled before entry, and {run.open} were still open when the candles ran out.
                            </li>
                            {run.failed.length > 0 && (
                                <li className="text-amber-200">Could not load: {run.failed.join(', ')}.</li>
                            )}
                        </ul>
                    </section>

                    <StrategyRecordCard
                        history={run.results}
                        now={finishedAt}
                        title="Backtest record"
                        defaultWindow="all"
                    />

                    <section className="card text-xs leading-relaxed text-[var(--text-muted)]" aria-label="How to read this">
                        <h2 className="text-sm font-semibold text-[var(--foreground)]">How to read this</h2>
                        <ul className="mt-2 list-disc space-y-1.5 pl-5">
                            <li>
                                Timeframes cover different periods, so compare them in the &quot;Split by&quot; table
                                rather than adding them together. Use the 30d button for a like-for-like window.
                            </li>
                            <li>
                                A candle shows its range, not the order prices traded in. Ties go against you:
                                a candle that touches both stop and target counts as a loss.
                                {run.ambiguous > 0 && (
                                    <> {run.ambiguous} {run.ambiguous === 1 ? 'candle' : 'candles'} touched entry and target together and {run.ambiguous === 1 ? 'was' : 'were'} counted as missed.</>
                                )}
                            </li>
                            <li>
                                It assumes every plan is taken with a limit entry, and exits only at the stop or the target.
                                Funding and slippage are not included.
                            </li>
                            <li>
                                Past results do not promise future ones. Treat this as evidence about the pattern, not a forecast.
                            </li>
                        </ul>
                    </section>
                </>
            )}
        </main>
    );
}
