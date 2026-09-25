'use client';

import { Link2, Settings2 } from 'lucide-react';
import AlertCenter from '@/components/alert-center';
import CoinSelector from '@/components/coin-selector';
import { HowToUseLauncher } from '@/components/how-to-use-launcher';
import TimeframeToggle from '@/components/timeframe-toggle';

interface DashboardHeaderProps {
    settingsOpen: boolean;
    onSettingsToggle: () => void;
}

export function DashboardHeader({
    settingsOpen,
    onSettingsToggle,
}: DashboardHeaderProps) {
    return (
        // z-50 keeps the header's popovers (alerts, glossary) above the sticky Now bar and the cards.
        <header className="material-chrome relative z-50 border-b border-[var(--hairline)]">
            <div className="mx-auto max-w-[1800px] px-4 py-3 sm:px-6 sm:py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                        <span
                            aria-hidden="true"
                            className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[var(--accent)]/45 bg-[var(--accent-dim)] text-[var(--accent)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.035)]"
                        >
                            <Link2 size={21} strokeWidth={2.35} />
                        </span>

                        <div className="min-w-0">
                            <h1 className="font-display flex items-baseline gap-1.5 text-[17px] font-bold leading-none tracking-[-0.035em] text-white sm:text-[19px]">
                                <span>CHAIN</span>
                                <span className="text-[var(--accent)]">TRADER</span>
                            </h1>
                            <p className="font-display mt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)] sm:text-[11px]">
                                Plan the retrace. Never chase.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <CoinSelector />
                        <TimeframeToggle />
                        <AlertCenter />
                        <HowToUseLauncher />
                        <button
                            type="button"
                            aria-label="Settings"
                            aria-expanded={settingsOpen}
                            onClick={onSettingsToggle}
                            className={`btn px-3 ${
                                settingsOpen
                                    ? 'border border-[var(--accent)]/60 bg-[var(--accent-dim)] text-[var(--accent)]'
                                    : 'btn-outline'
                            }`}
                        >
                            <Settings2 aria-hidden="true" size={18} strokeWidth={2} />
                            <span className="hidden sm:inline">Settings</span>
                        </button>
                    </div>
                </div>
            </div>
        </header>
    );
}
