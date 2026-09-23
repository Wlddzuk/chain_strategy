'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface HowToUseDrawerProps {
    open: boolean;
    onClose: () => void;
}

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => !element.hasAttribute('hidden'));
}

export function HowToUseDrawer({ open, onClose }: HowToUseDrawerProps) {
    const titleId = useId();
    const descriptionId = useId();
    const panelRef = useRef<HTMLElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!open) return;

        const previouslyFocused = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const focusFrame = window.requestAnimationFrame(() => {
            closeButtonRef.current?.focus();
        });

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }

            if (event.key !== 'Tab' || !panelRef.current) return;

            const focusableElements = getFocusableElements(panelRef.current);
            if (focusableElements.length === 0) {
                event.preventDefault();
                panelRef.current.focus();
                return;
            }

            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];
            const activeElement = document.activeElement;

            if (!panelRef.current.contains(activeElement)) {
                event.preventDefault();
                (event.shiftKey ? lastElement : firstElement).focus();
            } else if (event.shiftKey && activeElement === firstElement) {
                event.preventDefault();
                lastElement.focus();
            } else if (!event.shiftKey && activeElement === lastElement) {
                event.preventDefault();
                firstElement.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousBodyOverflow;
            if (previouslyFocused?.isConnected) previouslyFocused.focus();
        };
    }, [open]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[110]">
            <div
                aria-hidden="true"
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={() => onCloseRef.current()}
            />

            <section
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                tabIndex={-1}
                className="absolute inset-y-0 right-0 flex h-dvh w-full max-w-3xl flex-col border-l border-[var(--card-border)] bg-[var(--card-bg)] shadow-2xl"
            >
                <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--card-border)] bg-[var(--card-bg)] px-5 py-4 sm:px-8">
                    <div>
                        <h2 id={titleId} className="text-xl font-bold sm:text-2xl">
                            How to use Chain Trader
                        </h2>
                        <p
                            id={descriptionId}
                            className="mt-1 text-sm italic text-[var(--text-muted)]"
                        >
                            Plain-English guide. Read once, keep for reference.
                        </p>
                    </div>
                    <button
                        ref={closeButtonRef}
                        type="button"
                        onClick={() => onCloseRef.current()}
                        className="shrink-0 rounded-lg border border-[var(--card-border)] p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--card-hover)] hover:text-white"
                        aria-label="Close how to use guide"
                    >
                        <X aria-hidden="true" size={20} strokeWidth={2} />
                    </button>
                </header>

                <article className="flex-1 space-y-10 overflow-y-auto overscroll-contain px-5 py-8 text-sm leading-7 sm:px-8 sm:text-[15px]">
                    <section aria-labelledby={`${titleId}-purpose`}>
                        <h3
                            id={`${titleId}-purpose`}
                            className="mb-3 text-lg font-bold text-white"
                        >
                            What this tool does — and does not do
                        </h3>
                        <div className="space-y-3 text-[var(--foreground)]">
                            <p>
                                Chain Trader watches 8 crypto markets on Hyperliquid and looks for one specific pattern (the &quot;Chain&quot; supply-and-demand setup). When it finds one, it builds a complete trade plan for you: Entry, Stop, Target, and position size.
                            </p>
                            <p>
                                <strong>It never places orders.</strong> You place them yourself on your exchange. The tool tells you WHEN and WHAT — you do the clicking on the exchange side.
                            </p>
                        </div>
                    </section>

                    <section aria-labelledby={`${titleId}-screen`}>
                        <h3
                            id={`${titleId}-screen`}
                            className="mb-3 text-lg font-bold text-white"
                        >
                            The screen, top to bottom
                        </h3>
                        <ul className="list-disc space-y-2 pl-5 marker:text-[var(--accent)]">
                            <li>
                                <strong>Now bar</strong> (under the header): the single most important thing right now. If it says ENTRY HIT, act. If it says &quot;Closest setup...&quot;, relax and watch.
                            </li>
                            <li>
                                <strong>Stats row</strong>: current price, number of active plans, your risk settings, connection health, scanner status.
                            </li>
                            <li>
                                <strong>Chart</strong>: candles plus the zones the strategy found. Toggle RSI, Bollinger Bands, EMAs with the toolbar buttons.
                            </li>
                            <li>
                                <strong>Trade Signals</strong>: the active plans. Each card leads with a colored status strip — that strip is the only thing you need to read at a glance.
                            </li>
                            <li>
                                <strong>Setups forming</strong>: early warnings. Price is near a zone, but nothing is confirmed yet. Watch, don&apos;t act.
                            </li>
                            <li>
                                <strong>Strategy record</strong>: the tool&apos;s own scoreboard of how its plans would have performed. Check it weekly.
                            </li>
                            <li>
                                <strong>Recent Activity</strong>: history of finished plans.
                            </li>
                        </ul>
                    </section>

                    <section aria-labelledby={`${titleId}-statuses`}>
                        <h3
                            id={`${titleId}-statuses`}
                            className="mb-3 text-lg font-bold text-white"
                        >
                            What the status strips mean
                        </h3>
                        <div className="overflow-x-auto rounded-xl border border-[var(--card-border)]">
                            <table className="w-full min-w-[42rem] border-collapse text-left text-xs sm:text-sm">
                                <thead className="bg-[var(--background)] text-[var(--text-muted)]">
                                    <tr>
                                        <th scope="col" className="px-4 py-3 font-semibold">Strip</th>
                                        <th scope="col" className="px-4 py-3 font-semibold">Meaning</th>
                                        <th scope="col" className="px-4 py-3 font-semibold">What you do</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[var(--card-border)]">
                                    <tr>
                                        <th scope="row" className="whitespace-nowrap px-4 py-3 font-bold text-white">⏳ WAITING</th>
                                        <td className="px-4 py-3">Plan exists, price hasn&apos;t come back to entry</td>
                                        <td className="px-4 py-3">Nothing yet. Optionally place a limit order and wait.</td>
                                    </tr>
                                    <tr>
                                        <th scope="row" className="whitespace-nowrap px-4 py-3 font-bold text-amber-200">⚡ GET READY</th>
                                        <td className="px-4 py-3">Price is close to the entry</td>
                                        <td className="px-4 py-3">If you want this trade, place your limit order now.</td>
                                    </tr>
                                    <tr>
                                        <th scope="row" className="whitespace-nowrap px-4 py-3 font-bold text-sky-200">📋 ORDER PLAN ACTIVE</th>
                                        <td className="px-4 py-3">You approved the plan</td>
                                        <td className="px-4 py-3">Make sure your exchange orders match the plan.</td>
                                    </tr>
                                    <tr>
                                        <th scope="row" className="whitespace-nowrap px-4 py-3 font-bold text-amber-200">⚠️ ENTRY HIT — do not chase</th>
                                        <td className="px-4 py-3">Entry traded but you weren&apos;t in</td>
                                        <td className="px-4 py-3">Skip it. Entering late breaks the strategy&apos;s math.</td>
                                    </tr>
                                    <tr>
                                        <th scope="row" className="whitespace-nowrap px-4 py-3 font-bold text-[var(--long-green)]">✅ IN TRADE (planned)</th>
                                        <td className="px-4 py-3">Entry filled (by plan bookkeeping)</td>
                                        <td className="px-4 py-3">Manage nothing — stop and target are already set.</td>
                                    </tr>
                                    <tr>
                                        <th scope="row" className="whitespace-nowrap px-4 py-3 font-bold text-white">🏁 CLOSED</th>
                                        <td className="px-4 py-3">Plan finished, would have won or lost</td>
                                        <td className="px-4 py-3">Note the result. The scoreboard records it.</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <section aria-labelledby={`${titleId}-sounds`}>
                        <h3
                            id={`${titleId}-sounds`}
                            className="mb-3 text-lg font-bold text-white"
                        >
                            What the sounds mean
                        </h3>
                        <p>
                            Open Settings → Alerts and press each <strong>Test</strong> button once so your ear learns them:
                        </p>
                        <ul className="mt-3 list-disc space-y-2 pl-5 marker:text-[var(--accent)]">
                            <li><strong>Soft tick</strong> — new signal or forming setup. Information only. No action.</li>
                            <li><strong>Two rising notes</strong> — price is approaching an entry. Look at the screen soon.</li>
                            <li><strong>Three-note rising melody</strong> — ENTRY HIT. Act now if this is your trade.</li>
                            <li><strong>Pleasant chord</strong> — target hit. <strong>Two low falling notes</strong> — stop hit.</li>
                            <li><strong>Voice</strong> — speaks the market and action so you don&apos;t have to look at all.</li>
                        </ul>
                    </section>

                    <section aria-labelledby={`${titleId}-workflow`}>
                        <h3
                            id={`${titleId}-workflow`}
                            className="mb-3 text-lg font-bold text-white"
                        >
                            Your daily workflow
                        </h3>
                        <ol className="list-decimal space-y-3 pl-5 marker:font-bold marker:text-[var(--accent)]">
                            <li>Open the app, check the <strong>Now bar</strong> and the candle-close countdown.</li>
                            <li>When a <strong>new signal</strong> beeps, open the card. Check the status strip and &quot;net after fees&quot; R:R.</li>
                            <li>If you want the trade: click <strong>Open Plan</strong>, set your balance/risk, click <strong>Accept</strong>. Then place the SAME three orders on your exchange: Entry (limit order), Stop, Target. Use the <strong>copy buttons</strong> — never retype numbers by hand.</li>
                            <li>Tick the three checkboxes on the plan (Entry order placed / Stop set / Target set).</li>
                            <li>Walk away. The tool will tell you: <strong>entry hit</strong> (you&apos;re in), <strong>invalidated</strong> (cancel your exchange orders NOW), <strong>target/stop hit</strong> (trade over).</li>
                            <li>Never act on an ⚠️ ENTRY HIT card you didn&apos;t already plan — that trade is gone.</li>
                            <li>Check the <strong>Strategy record</strong> weekly. It shows how plans performed. If the record is bad over many trades, stop and re-evaluate — do not argue with your own data.</li>
                        </ol>
                    </section>

                    <section aria-labelledby={`${titleId}-rules`}>
                        <h3
                            id={`${titleId}-rules`}
                            className="mb-3 text-lg font-bold text-white"
                        >
                            The three golden rules
                        </h3>
                        <ol className="list-decimal space-y-3 pl-5 marker:font-bold marker:text-amber-300">
                            <li><strong>INVALIDATED or MISSED = cancel your exchange orders immediately.</strong> The setup is dead; a resting limit order can fill into a falling market.</li>
                            <li><strong>Never chase a hit Entry.</strong> The Stop-to-Target math only works from the planned Entry.</li>
                            <li><strong>Most setups will be MISSED — that is normal.</strong> The strategy places limit orders at retracement levels; price often runs without coming back. Missing a trade costs nothing. A bad entry costs money.</li>
                        </ol>
                    </section>

                    <section aria-labelledby={`${titleId}-limits`}>
                        <h3
                            id={`${titleId}-limits`}
                            className="mb-3 text-lg font-bold text-white"
                        >
                            Honest limits of this tool
                        </h3>
                        <ul className="list-disc space-y-2 pl-5 marker:text-[var(--accent)]">
                            <li>Outcomes (&quot;would have won/lost&quot;) are based on price touches, not your real fills. Slippage, funding, and partial fills are not simulated.</li>
                            <li>A signal is a pattern match, not a prophecy. The Strategy record tells you over time whether the pattern earns.</li>
                            <li>If the scoreboard shows fewer than ~10 resolved plans, it is too early to judge anything.</li>
                        </ul>
                    </section>
                </article>
            </section>
        </div>
    );
}
