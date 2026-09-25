'use client';

import { useEffect, useRef, useState } from 'react';

interface CopyButtonProps {
    label: string;
    value: string | number;
    className?: string;
    text?: string;
}

async function copyText(value: string): Promise<void> {
    if (!navigator.clipboard?.writeText) {
        // Some embedded webviews report success from execCommand without
        // exposing an actual clipboard. Use the explicit selected-value
        // fallback instead of falsely claiming the value was copied.
        throw new Error('Clipboard API unavailable');
    }

    await navigator.clipboard.writeText(value);
}

export default function CopyButton({ label, value, className = '', text }: CopyButtonProps) {
    const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle');
    const resetTimerRef = useRef<number | null>(null);
    const manualInputRef = useRef<HTMLInputElement>(null);

    const copied = status === 'copied';

    useEffect(() => () => {
        if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    }, []);

    useEffect(() => {
        if (status !== 'manual') return;
        manualInputRef.current?.focus();
        manualInputRef.current?.select();
    }, [status]);

    const handleCopy = async () => {
        try {
            await copyText(String(value));
            setStatus('copied');
            if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
            resetTimerRef.current = window.setTimeout(() => setStatus('idle'), 1500);
        } catch {
            setStatus('manual');
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={handleCopy}
                className={`inline-flex h-6 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--card-hover)] hover:text-white ${text ? 'w-auto gap-1.5 px-2' : 'w-6'} ${className}`}
                aria-label={copied ? `${label} copied` : `Copy ${label}`}
                title={copied ? 'Copied' : `Copy ${label}`}
            >
                {copied ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                        <path d="M5 12l4 4L19 6" />
                    </svg>
                ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <rect x="9" y="9" width="11" height="11" rx="2" />
                        <path d="M15 9V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7a2 2 0 002 2h3" />
                    </svg>
                )}
                {text && <span>{copied ? 'Copied' : text}</span>}
            </button>

            {status === 'manual' && (
                <div className="fixed inset-x-4 bottom-4 z-[90] rounded-xl border border-amber-400/50 bg-[var(--card-bg)] p-3 shadow-2xl" role="status">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-amber-200">Clipboard access is blocked in this browser</p>
                            <p className="mt-1 text-[11px] text-[var(--text-muted)]">The raw value is selected. Press ⌘C to copy it without retyping.</p>
                            <input
                                ref={manualInputRef}
                                readOnly
                                value={String(value)}
                                onFocus={(event) => event.currentTarget.select()}
                                className="input mt-2 w-full font-mono text-sm"
                                aria-label={`${label} raw value`}
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => setStatus('idle')}
                            className="rounded p-1 text-[var(--text-muted)] hover:text-white"
                            aria-label="Close copy fallback"
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
